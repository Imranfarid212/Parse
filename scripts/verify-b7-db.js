/**
 * B7 — the export job lifecycle and the export read path, against a live database.
 *
 * The static checks in verify-b7-backend.js read the migration as text. This one
 * runs it. The claims it proves are the ones that only exist at runtime:
 *
 *   * an export reads exactly what search reads (T7.1's premise — if these two
 *     ever disagree, the user exports a set they never saw);
 *   * a lease means a second worker cannot build the same export twice;
 *   * a failed job retries and then gives up rather than sitting in `running`;
 *   * a client cannot write its own job row to `done`.
 *
 * It creates throwaway users and deletes them. No model is ever called, so it is
 * free to run as often as you like.
 *
 * Local (default):
 *   supabase start -x vector && supabase db reset
 *   npm run b7:db:verify
 *
 * Staging: point it at one, same variables as the other harnesses.
 *   B7_DB_ENV_FILE=.env.staging npm run b7:db:verify
 */
const { createClient } = require('@supabase/supabase-js');

const { connectPg, localKeys, makeAdmin, readEnvFile, withUser } = require('./lib/staging');

const TAG = '[b7:db]';

const LOCAL = {
  url: 'http://127.0.0.1:54321',
  dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
};

const results = [];
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

async function test(name, fn) {
  checks = 0;
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, status: 'passed', checks, ms: Date.now() - startedAt });
    console.log(`  PASS ${name} (${checks} checks, ${Date.now() - startedAt}ms)`);
  } catch (error) {
    results.push({ name, status: 'failed', checks, ms: Date.now() - startedAt, error: error.message });
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}

/**
 * Resolves against the local stack unless pointed elsewhere. Local is the
 * default because this script is meant to run on every change, and a harness
 * that needs a hosted project to run is a harness that stops being run.
 */
function resolveTarget() {
  const envFile = process.env.B7_DB_ENV_FILE;
  const fromFile = envFile ? { ...readEnvFile('.env'), ...readEnvFile(envFile) } : {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (process.env[key]) return process.env[key];
      if (fromFile[key]) return fromFile[key];
    }
    return null;
  };

  // With nothing configured, ask the CLI where the local stack is. That makes
  // `npm run b7:db:verify` work straight after `supabase start`, with no
  // exported variables to remember.
  const local = envFile ? null : localKeys();

  const url = pick('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL') ?? local?.url ?? LOCAL.url;
  const dbUrl = pick('SUPABASE_DB_URL') ?? local?.dbUrl ?? LOCAL.dbUrl;
  const serviceRoleKey = pick('SUPABASE_SERVICE_ROLE_KEY') ?? local?.serviceRoleKey;
  const anonKey = pick('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY') ?? local?.anonKey;

  if (!serviceRoleKey || !anonKey) {
    throw new Error(
      `${TAG} found no local stack and no configured project.\n` +
        '  Local:   supabase start -x vector && supabase db reset\n' +
        '  Staging: B7_DB_ENV_FILE=.env.staging npm run b7:db:verify',
    );
  }

  const production = readEnvFile('.env.production').EXPO_PUBLIC_SUPABASE_URL;
  if (production && production === url) {
    throw new Error(`${TAG} refusing to run against the project in .env.production`);
  }

  return { url, dbUrl, serviceRoleKey, anonKey };
}

/** Nine receipts: three currencies, three categories, one already soft-deleted. */
async function seedReceipts(pg, userId) {
  await pg.query(
    `insert into public.user_categories (user_id, category_id, sort_order)
     select $1::uuid, id, row_number() over (order by id) from public.categories
     on conflict (user_id, category_id) do nothing`,
    [userId],
  );
  const { rows } = await pg.query(
    `insert into public.receipts (
       user_id, capture_id, status, confirmed_via, capture_mode, provider,
       merchant, txn_date, currency, total, category_id, notes, image_path, deleted_at
     )
     select $1::uuid, gen_random_uuid(), 'confirmed', 'user', 'default', 'grok',
            format('B7 Merchant %s', lpad(n::text, 2, '0')),
            date '2026-07-01' + (n - 1),
            case n % 3 when 1 then 'USD' when 2 then 'EUR' else 'GBP' end,
            round((10 + n * 5)::numeric, 2),
            case when n % 3 = 0 then 10 else n % 3 end,
            format('B7 note %s', n),
            case when n = 4 then null else format('%s/receipt-%s.jpg', $1::uuid, n) end,
            case when n = 9 then now() - interval '1 day' else null end
     from generate_series(1, 9) n
     returning id, txn_date, currency, total, deleted_at`,
    [userId],
  );
  await pg.query(
    `insert into public.receipt_items (receipt_id, name, qty, amount)
     select id, 'B7 line item', 1, total from public.receipts where user_id = $1 and deleted_at is null`,
    [userId],
  );
  return rows;
}

async function signedInClient(config, email, password) {
  const client = createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in the test user: ${error.message}`);
  return client;
}

async function main() {
  const config = resolveTarget();
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  console.log(`${TAG} target ${config.url}`);

  try {
    await withUser(
      admin,
      async ({ userId, email, password }) => {
        await seedReceipts(pg, userId);
        const user = await signedInClient(config, email, password);

        await test('export rows are exactly the rows search returns', async () => {
          const filterSets = [
            {},
            { p_date_from: '2026-07-03', p_date_to: '2026-07-06' },
            { p_amount_min: 20, p_amount_max: 40, p_amount_currency: 'USD' },
            { p_text: 'Merchant 05' },
            { p_category_ids: [10] },
          ];

          for (const filters of filterSets) {
            const searched = await user.rpc('search_receipts', filters);
            if (searched.error) throw new Error(`search_receipts failed: ${searched.error.message}`);
            const exported = await admin.rpc('export_receipt_rows', { p_user_id: userId, ...filters });
            if (exported.error) throw new Error(`export_receipt_rows failed: ${exported.error.message}`);

            const searchedIds = searched.data.map((row) => row.id).sort();
            const exportedIds = exported.data.map((row) => row.id).sort();
            assertEqual(exportedIds, searchedIds, `filters ${JSON.stringify(filters)} disagree between search and export`);
          }
        });

        await test('a soft-deleted receipt is never exported', async () => {
          const { rows } = await pg.query(
            'select id from public.receipts where user_id = $1 and deleted_at is not null',
            [userId],
          );
          assert(rows.length === 1, 'the fixture should contain exactly one soft-deleted receipt');
          const { data, error } = await admin.rpc('export_receipt_rows', { p_user_id: userId });
          if (error) throw new Error(error.message);
          assert(!data.some((row) => row.id === rows[0].id), 'a soft-deleted receipt appeared in the export');
          assertEqual(data.length, 8, 'the export should hold the eight live receipts');
        });

        await test('rows come back in date order, which the images PDF depends on', async () => {
          const { data, error } = await admin.rpc('export_receipt_rows', { p_user_id: userId });
          if (error) throw new Error(error.message);
          const dates = data.map((row) => row.txn_date);
          assertEqual(dates, [...dates].sort(), 'export rows are not date-ordered');
        });

        await test('an amount filter without a currency is refused', async () => {
          const { error } = await admin.rpc('export_receipt_rows', { p_user_id: userId, p_amount_min: 10 });
          assert(error, 'an amount filter with no currency should have been rejected');
          assert(
            /amount_currency is required/i.test(error.message),
            `unexpected rejection message: ${error.message}`,
          );
        });

        await test('the export read path is service-role only', async () => {
          const { error } = await user.rpc('export_receipt_rows', { p_user_id: userId });
          assert(error, 'a signed-in user must not be able to read another path into their receipts');
        });

        await test('enqueue, claim, complete', async () => {
          const { data: job, error } = await admin.rpc('enqueue_export_job', {
            p_user_id: userId,
            p_filters: { date_from: '2026-07-01' },
            p_format: 'xlsx',
            p_include_images: false,
          });
          if (error) throw new Error(error.message);
          assertEqual(job.status, 'queued', 'a new job should be queued');
          assertEqual(job.attempt_count, 0, 'a new job has no attempts');

          const first = await admin.rpc('claim_export_job', { p_job_id: job.id });
          if (first.error) throw new Error(first.error.message);
          assertEqual(first.data.length, 1, 'the first claim should win the job');
          assertEqual(first.data[0].status, 'running', 'a claimed job is running');
          assertEqual(first.data[0].attempt_count, 1, 'claiming counts an attempt');

          const second = await admin.rpc('claim_export_job', { p_job_id: job.id });
          if (second.error) throw new Error(second.error.message);
          assertEqual(second.data.length, 0, 'a leased job must not be claimable by a second worker');

          const artifacts = [
            { kind: 'workbook', file_name: 'receiptflow_export_2026-08-05.xlsx', file_path: `${userId}/${job.id}/receiptflow_export_2026-08-05.xlsx`, byte_size: 2048, receipt_count: 8, part: 1, part_count: 1 },
          ];
          const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
          const completed = await admin.rpc('complete_export_job', {
            p_job_id: job.id,
            p_artifacts: artifacts,
            p_receipt_count: 8,
            p_expires_at: expiresAt,
          });
          if (completed.error) throw new Error(completed.error.message);
          assertEqual(completed.data.status, 'done', 'a completed job is done');
          assertEqual(completed.data.receipt_count, 8, 'the receipt count is recorded');
          assertEqual(completed.data.file_path, artifacts[0].file_path, 'file_path points at the first artifact');
          assert(completed.data.locked_at === null, 'completing releases the lease');
        });

        await test('a job that keeps failing retries twice and then gives up', async () => {
          const { data: job } = await admin.rpc('enqueue_export_job', {
            p_user_id: userId,
            p_filters: {},
            p_format: 'pdf',
            p_include_images: false,
          });

          const seen = [];
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            const claimed = await admin.rpc('claim_export_job', { p_job_id: job.id, p_lease_seconds: 30 });
            if (claimed.error) throw new Error(claimed.error.message);
            assertEqual(claimed.data.length, 1, `attempt ${attempt} should be claimable`);
            const failed = await admin.rpc('fail_export_job', {
              p_job_id: job.id,
              p_error: 'storage is down',
              p_backoff_seconds: 5,
            });
            if (failed.error) throw new Error(failed.error.message);
            seen.push(failed.data.status);
            // The backoff is real, so the next claim needs the retry time moved back.
            await pg.query('update public.export_jobs set next_retry_at = now() where id = $1', [job.id]);
          }
          assertEqual(seen, ['queued', 'queued', 'failed'], 'a job should retry twice and then fail');

          const exhausted = await admin.rpc('claim_export_job', { p_job_id: job.id });
          assertEqual(exhausted.data.length, 0, 'a failed job is not claimable again by a worker');

          const retried = await user.rpc('retry_export_job', { p_job_id: job.id });
          if (retried.error) throw new Error(retried.error.message);
          assertEqual(retried.data.status, 'queued', 'the user can retry a failed export');
          assertEqual(retried.data.attempt_count, 0, 'a user retry starts the attempts over');
          await pg.query("update public.export_jobs set status = 'done' where id = $1", [job.id]);
        });

        await test('a user cannot have unlimited exports running at once', async () => {
          await pg.query("delete from public.export_jobs where user_id = $1 and status in ('queued','running')", [userId]);
          for (let index = 0; index < 3; index += 1) {
            const { error } = await admin.rpc('enqueue_export_job', {
              p_user_id: userId,
              p_filters: {},
              p_format: 'xlsx',
              p_include_images: false,
            });
            if (error) throw new Error(`enqueue ${index + 1} failed: ${error.message}`);
          }
          const { error } = await admin.rpc('enqueue_export_job', {
            p_user_id: userId,
            p_filters: {},
            p_format: 'xlsx',
            p_include_images: false,
          });
          assert(error, 'a fourth concurrent export should have been refused');
          assert(/too many exports/i.test(error.message), `unexpected refusal: ${error.message}`);
          await pg.query("delete from public.export_jobs where user_id = $1 and status in ('queued','running')", [userId]);
        });

        await test('a client can read its jobs and write none of them', async () => {
          const { data: job } = await admin.rpc('enqueue_export_job', {
            p_user_id: userId,
            p_filters: {},
            p_format: 'xlsx',
            p_include_images: false,
          });

          const readable = await user.from('export_jobs').select('id,status').eq('id', job.id);
          if (readable.error) throw new Error(readable.error.message);
          assertEqual(readable.data.length, 1, 'a user must be able to watch their own export');

          const forged = await user
            .from('export_jobs')
            .update({ status: 'done', file_path: 'somewhere/else.xlsx' })
            .eq('id', job.id)
            .select();
          assert(
            forged.error || (forged.data ?? []).length === 0,
            'a user must not be able to mark their own export done',
          );

          const { rows } = await pg.query('select status from public.export_jobs where id = $1', [job.id]);
          assertEqual(rows[0].status, 'queued', 'the forged update must not have landed');
          await pg.query('delete from public.export_jobs where id = $1', [job.id]);
        });

        await test('expired exports are selected for purge and their files queued', async () => {
          const { data: job } = await admin.rpc('enqueue_export_job', {
            p_user_id: userId,
            p_filters: {},
            p_format: 'xlsx',
            p_include_images: false,
          });
          const filePath = `${userId}/${job.id}/receiptflow_export_2026-08-05.xlsx`;
          await admin.rpc('claim_export_job', { p_job_id: job.id });
          await admin.rpc('complete_export_job', {
            p_job_id: job.id,
            p_artifacts: [{ kind: 'workbook', file_name: 'receiptflow_export_2026-08-05.xlsx', file_path: filePath, byte_size: 10, receipt_count: 8, part: 1, part_count: 1 }],
            p_receipt_count: 8,
            p_expires_at: new Date(Date.now() - 1000).toISOString(),
          });

          const dry = await admin.rpc('purge_expired_exports', { p_before: new Date().toISOString(), p_dry_run: true });
          if (dry.error) throw new Error(dry.error.message);
          assert(dry.data.some((row) => row.out_file_path === filePath), 'the dry run should list the expired file');

          const { rows: before } = await pg.query('select artifacts from public.export_jobs where id = $1', [job.id]);
          assertEqual(before[0].artifacts.length, 1, 'the job should still list its artifact before the purge');

          const purged = await admin.rpc('purge_expired_exports', { p_before: new Date().toISOString(), p_dry_run: false });
          if (purged.error) throw new Error(purged.error.message);
          assert(purged.data.some((row) => row.out_file_path === filePath), 'the purge should return the file to delete');

          const { rows: queued } = await pg.query('select file_path from public.export_file_purge_queue where file_path = $1', [filePath]);
          assertEqual(queued.length, 1, 'the file must be queued for Storage deletion, not just forgotten');
          const { rows: after } = await pg.query('select artifacts, file_path from public.export_jobs where id = $1', [job.id]);
          assertEqual(after[0].artifacts.length, 0, 'an expired job should no longer advertise files');
          assert(after[0].file_path === null, 'an expired job should no longer carry a file path');

          await pg.query('delete from public.export_file_purge_queue where file_path = $1', [filePath]);
          await pg.query('delete from public.export_jobs where id = $1', [job.id]);
        });

        await test('export progress is published over Realtime', async () => {
          const { rows } = await pg.query(
            `select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'export_jobs'`,
          );
          assertEqual(rows.length, 1, 'export_jobs must be in the supabase_realtime publication');
        });
      },
      pg,
    );

    // A second account proves the read path is scoped by user, not just by RLS
    // on the table the client sees.
    await withUser(
      admin,
      async ({ userId: strangerId }) => {
        await test("one account's export cannot contain another's receipts", async () => {
          const { data, error } = await admin.rpc('export_receipt_rows', { p_user_id: strangerId });
          if (error) throw new Error(error.message);
          assertEqual(data.length, 0, 'a fresh account must export nothing');
        });
      },
      pg,
    );
  } finally {
    await pg.end();
  }

  const failed = results.filter((result) => result.status === 'failed');
  console.log(`${TAG} ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
  console.log(`${TAG} PASS`);
}

main().catch((error) => {
  console.error(`${TAG} ${error.message}`);
  process.exit(1);
});
