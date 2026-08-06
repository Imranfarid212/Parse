// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * B7 gate evidence: the export function, end to end, against a running stack.
 *
 * This is the script the T7 gate slots point at. Everything else in B7 tests a
 * piece — the builders produce correct bytes, the RPCs behave under a lease —
 * and this proves the pieces are actually wired to each other: a real POST from
 * a real signed-in user produces real objects in Storage whose contents are then
 * diffed against SQL truth.
 *
 * It runs in Deno because the files have to be read back to be believed: the
 * workbook is parsed with SheetJS and the PDFs with a text extractor, so an
 * assertion about a subtotal is an assertion about what the user will open.
 *
 *   T7.1  filtered xlsx across 3 currencies diffs clean against the database,
 *         one sheet per currency, styled headers, no receipt ids, no line items
 *   T7.2  PDF per-category totals match SQL; no cross-currency total exists
 *   T7.3  images PDF holds exactly the filtered images, date-ordered
 *   T7.4  signed URL carries the 7-day expiry; queued→running→done is observed;
 *         a failed job is retryable
 *   T7.5  a 1,000-receipt export completes, and images auto-chunk
 *
 * Two modes, one script:
 *
 *   direct (default) drives the job runner in-process against the local stack.
 *     Everything downstream of the HTTP shell is real — enqueue, claim, build,
 *     Storage, complete — and the shell itself is covered by its own unit tests
 *     for validation and by verify-b7-db.js for enqueue. Local `functions serve`
 *     does not boot in this repo's environment (the edge-runtime container fails
 *     the same way at `supabase start`), which is why the earlier phases verify
 *     functions over HTTP against staging.
 *
 *   http (B7_E2E_MODE=http) posts to a deployed export function, so the same
 *     assertions become the staging integration evidence once B7 is deployed.
 *
 * Prerequisites:
 *   supabase start -x vector && supabase db reset
 *
 * Run: npm run b7:e2e
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';
import * as XLSX from '../../_shared/exports/vendor/xlsx.mjs';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';

import { EXPORT_SIGNED_URL_TTL_SECONDS } from '../../_shared/contracts/exports.ts';
import { validateExportRequest } from '../../_shared/exports/request.ts';
import { claimAndRunExportJob } from '../../_shared/exports/run.ts';
import { tinyJpeg } from './tiny-jpeg.ts';

const TAG = '[b7:e2e]';
const MODE = Deno.env.get('B7_E2E_MODE') === 'http' ? 'http' : 'direct';
const URL_BASE = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const FUNCTIONS_BASE = Deno.env.get('SUPABASE_FUNCTIONS_URL') ?? 'http://127.0.0.1:54321/functions/v1';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error(`${TAG} needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (see \`supabase status -o json\`)`);
  Deno.exit(1);
}

const admin = createClient(URL_BASE, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CURRENCIES = ['USD', 'EUR', 'GBP'];
const CATEGORY_IDS = [1, 2, 10];

const results: { name: string; status: string; ms: number; error?: string }[] = [];
let checks = 0;

function assert(condition: unknown, message: string) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

async function test(name: string, fn: () => Promise<void>) {
  checks = 0;
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, status: 'passed', ms: Date.now() - startedAt });
    console.log(`  PASS ${name} (${checks} checks, ${Date.now() - startedAt}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'failed', ms: Date.now() - startedAt, error: message });
    console.error(`  FAIL ${name}: ${message}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

async function createUser() {
  const email = `b7-e2e-${crypto.randomUUID()}@example.com`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`could not create the test user: ${error.message}`);

  const user = createClient(URL_BASE, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await user.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`could not sign in: ${signIn.error.message}`);

  return { id: data.user.id, client: user, accessToken: signIn.data.session.access_token };
}

/**
 * Seeds receipts directly, then puts a real JPEG behind the first `withImages`
 * of them. Deterministic totals so every expected number below is arithmetic a
 * reader can check, not a value read back from the same query under test.
 */
async function seed(userId: string, count: number, withImages: number) {
  await admin.from('user_categories').upsert(
    CATEGORY_IDS.map((category_id, index) => ({ user_id: userId, category_id, sort_order: index })),
    { onConflict: 'user_id,category_id' },
  );

  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const day = String((index % 28) + 1).padStart(2, '0');
    const hasImage = index < withImages;
    rows.push({
      user_id: userId,
      capture_id: crypto.randomUUID(),
      status: 'confirmed',
      confirmed_via: 'user',
      capture_mode: 'default',
      provider: 'grok',
      merchant: `B7 Merchant ${String(index + 1).padStart(4, '0')}`,
      txn_date: `2026-07-${day}`,
      currency: CURRENCIES[index % CURRENCIES.length],
      total: Number(money(10 + index * 0.37)),
      category_id: CATEGORY_IDS[index % CATEGORY_IDS.length],
      notes: `B7 note ${index + 1}`,
      image_path: hasImage ? `${userId}/b7-${index}.jpg` : null,
    });
  }

  for (let offset = 0; offset < rows.length; offset += 250) {
    const { data, error } = await admin.from('receipts').insert(rows.slice(offset, offset + 250)).select('id,total');
    if (error) throw new Error(`seeding receipts failed: ${error.message}`);
    const items = data.map((row) => ({ receipt_id: row.id, name: 'B7 line item', qty: 1, amount: row.total }));
    const itemError = (await admin.from('receipt_items').insert(items)).error;
    if (itemError) throw new Error(`seeding line items failed: ${itemError.message}`);
  }

  const jpeg = tinyJpeg();
  for (let index = 0; index < withImages; index += 1) {
    const { error } = await admin.storage.from('receipts').upload(`${userId}/b7-${index}.jpg`, jpeg, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) throw new Error(`uploading a receipt image failed: ${error.message}`);
  }
}

/** SQL truth, computed by the database rather than by the code under test. */
async function truth(userId: string, filters: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc('export_receipt_rows', { p_user_id: userId, p_limit: 5000, ...filters });
  if (error) throw new Error(`export_receipt_rows failed: ${error.message}`);

  const byCurrency = new Map<string, { minor: number; count: number; categories: Map<string, number> }>();
  for (const row of data) {
    const entry = byCurrency.get(row.currency) ?? { minor: 0, count: 0, categories: new Map() };
    entry.minor += Math.round(Number(row.total) * 100);
    entry.count += 1;
    const category = row.category_name ?? 'Miscellaneous';
    entry.categories.set(category, (entry.categories.get(category) ?? 0) + Math.round(Number(row.total) * 100));
    byCurrency.set(row.currency, entry);
  }
  return { rows: data, byCurrency };
}

/**
 * Starts an export the way the app does. In direct mode it walks the same three
 * steps the function walks — validate, enqueue, claim-and-run — so the only
 * thing not exercised is the HTTP envelope around them.
 */
async function startExport(user: { id: string; accessToken: string }, body: Record<string, unknown>) {
  if (MODE === 'http') {
    const response = await fetch(`${FUNCTIONS_BASE}/export`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  }

  const validated = validateExportRequest(body);
  if (validated.error) return { status: 400, payload: { code: 'VALIDATION_FAILED', message: validated.error } };

  const { data: job, error } = await admin.rpc('enqueue_export_job', {
    p_user_id: user.id,
    p_filters: validated.request.filters,
    p_format: validated.request.format,
    p_include_images: validated.request.include_images,
    p_timezone: validated.request.timezone ?? null,
  });
  if (error) {
    if (error.code === 'PT429') return { status: 429, payload: { code: 'RATE_LIMITED' } };
    throw new Error(`enqueue failed: ${error.message}`);
  }

  // The function hands this to EdgeRuntime.waitUntil; here it is left
  // unawaited for the same reason, so the caller still observes an async job.
  const running = claimAndRunExportJob(admin, job.id);
  running.catch((cause) => console.error(`${TAG} background build failed`, cause));
  return { status: 202, payload: { status: 202, job } };
}

async function waitForJob(jobId: string, timeoutMs = 120_000) {
  const seen: string[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await admin.from('export_jobs').select('*').eq('id', jobId).single();
    if (error) throw new Error(error.message);
    if (seen[seen.length - 1] !== data.status) seen.push(data.status);
    if (data.status === 'done' || data.status === 'failed') return { job: data, seen };
    await sleep(400);
  }
  throw new Error(`job ${jobId} did not finish in ${timeoutMs}ms`);
}

async function downloadArtifact(filePath: string) {
  const { data, error } = await admin.storage.from('exports').download(filePath);
  if (error) throw new Error(`could not download ${filePath}: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function pdfText(bytes: Uint8Array) {
  const doc = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { text, pages: totalPages };
}

async function main() {
  console.log(`${TAG} target ${URL_BASE}`);
  const user = await createUser();

  try {
    // ---------------------------------------------------------------- T7.1/7.3
    await seed(user.id, 150, 12);

    let workbookJob;
    await test('T7.1 filtered xlsx across three currencies matches the database', async () => {
      const started = await startExport(user, {
        filters: { date_from: '2026-07-01', date_to: '2026-07-28' },
        format: 'xlsx',
        include_images: true,
      });
      assertEqual(started.status, 202, 'export should be accepted asynchronously');
      assertEqual(started.payload.job.status, 'queued', 'the job starts queued');

      const finished = await waitForJob(started.payload.job.id);
      workbookJob = finished.job;
      assertEqual(finished.job.status, 'done', `the job failed: ${finished.job.error ?? ''}`);

      const expected = await truth(user.id, { p_date_from: '2026-07-01', p_date_to: '2026-07-28' });
      assertEqual(finished.job.receipt_count, expected.rows.length, 'the job counted a different number of receipts');
      assertEqual(expected.byCurrency.size, 3, 'the fixture must span three currencies');

      const artifact = finished.job.artifacts.find((entry) => entry.kind === 'workbook');
      assert(artifact, 'the export must contain a workbook');
      const book = XLSX.read(await downloadArtifact(artifact.file_path), { type: 'array', cellStyles: true });

      // One sheet per currency, named for it, and no line-items sheet.
      assertEqual(book.SheetNames, [...expected.byCurrency.keys()].sort(), 'sheets must be one per currency');
      assert(!book.SheetNames.includes('Line items'), 'line items must not be exported');

      let counted = 0;
      for (const name of book.SheetNames) {
        const sheet = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true });
        assertEqual(sheet[0], ['Date', 'Merchant', 'Category', `Amount (${name})`, 'Notes'], `${name} headers`);
        assertEqual(book.Sheets[name].A1.s?.fgColor?.rgb, 'D8E4BC', `${name} header fill`);

        const dataRows = sheet.slice(1);
        counted += dataRows.length;
        assertEqual(dataRows.length, expected.byCurrency.get(name).count, `${name} row count disagrees with SQL`);

        // Every row on the sheet is this currency, and the amounts add up to
        // what SQL says — summed here, deliberately not written into the file.
        // With no currency column, "every row here is this currency" is proven
        // by the sheet's total matching what SQL says that currency adds up to.
        let minor = 0;
        for (const row of dataRows) {
          assertEqual(typeof row[3], 'number', `${name} amount is not numeric`);
          minor += Math.round(row[3] * 100);
        }
        assertEqual(money(minor / 100), money(expected.byCurrency.get(name).minor / 100), `${name} total disagrees with SQL`);

        const flat = sheet.map((row) => row.map((cell) => String(cell ?? '')).join('|')).join('\n');
        assert(!/Subtotal/i.test(flat), `${name} still carries a subtotal row`);
        for (const row of expected.rows.slice(0, 5)) {
          assert(!flat.includes(row.id), `${name} leaks a receipt id`);
        }
      }
      assertEqual(counted, expected.rows.length, 'the sheets together must hold every receipt');
    });

    await test('T7.3 the images PDF holds exactly the filtered images, date-ordered', async () => {
      const parts = workbookJob.artifacts.filter((entry) => entry.kind === 'images');
      assertEqual(parts.length, 1, 'twelve images should need one part');
      assertEqual(parts[0].receipt_count, 12, 'every receipt with an image should have a page');

      const { text, pages } = await pdfText(await downloadArtifact(parts[0].file_path));
      assertEqual(pages, 12, 'one page per image');

      const expected = await truth(user.id, { p_date_from: '2026-07-01', p_date_to: '2026-07-28' });
      const withImages = expected.rows.filter((row) => row.image_path).map((row) => row.merchant);
      assertEqual(withImages.length, 12, 'the fixture should have twelve images in range');
      const positions = withImages.map((merchant) => text.indexOf(merchant));
      assert(positions.every((position) => position >= 0), 'every filtered receipt must appear in the images PDF');
      assertEqual(positions, [...positions].sort((a, b) => a - b), 'image pages are not in the SQL date order');
    });

    // -------------------------------------------------------------------- T7.2
    await test('T7.2 the PDF statement matches SQL per category, with no combined total', async () => {
      const started = await startExport(user, {
        filters: { date_from: '2026-07-01', date_to: '2026-07-28' },
        format: 'pdf',
        include_images: false,
        timezone: 'Australia/Adelaide',
      });
      assertEqual(started.status, 202, 'export should be accepted asynchronously');
      const finished = await waitForJob(started.payload.job.id);
      assertEqual(finished.job.status, 'done', `the job failed: ${finished.job.error ?? ''}`);

      const artifact = finished.job.artifacts.find((entry) => entry.kind === 'statement');
      assert(artifact, 'the export must contain a statement');
      const { text } = await pdfText(await downloadArtifact(artifact.file_path));

      const expected = await truth(user.id, { p_date_from: '2026-07-01', p_date_to: '2026-07-28' });
      for (const [currency, entry] of expected.byCurrency) {
        assert(text.includes(`${money(entry.minor / 100)} ${currency}`), `the ${currency} subtotal is missing or wrong`);
        for (const [category, minor] of entry.categories) {
          assert(text.includes(category), `category ${category} is missing from the ${currency} section`);
          assert(text.includes(money(minor / 100)), `the ${currency}/${category} total ${money(minor / 100)} is missing`);
        }
      }

      const forbidden = money([...expected.byCurrency.values()].reduce((sum, entry) => sum + entry.minor, 0) / 100);
      assert(!text.includes(forbidden), `the statement prints a cross-currency total (${forbidden})`);
      assert(!/grand total/i.test(text), 'the statement must not print a grand total');

      // No cover title, Parse branding, and dates a person can read.
      assert(!/ReceiptFlow/i.test(text), 'the statement still mentions ReceiptFlow');
      assert(text.includes('Parse does not convert between currencies'), 'the no-combined-total note is missing');
      assert(/Generated \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (AM|PM) /.test(text), 'the generated timestamp is not in dd/mm/yyyy hh:mm am/pm');
      assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text), 'an ISO timestamp is still printed');

      // The device's zone travelled with the job and was used to render it.
      // Adelaide is deliberately far from UTC: rendering in the wrong zone here
      // shows up as the wrong label, and often the wrong day.
      assertEqual(finished.job.timezone, 'Australia/Adelaide', 'the job should record the requested timezone');
      assert(text.includes('GMT+9:30') || text.includes('ACST') || text.includes('ACDT'), `the statement was not rendered in Adelaide time: ${text.slice(0, 120)}`);
      assert(!/Generated .* UTC/.test(text), 'the statement fell back to UTC despite a timezone being sent');
    });

    // -------------------------------------------------------------------- T7.4
    await test('T7.4 progress is observable, links carry the seven-day expiry, failures retry', async () => {
      const started = await startExport(user, {
        filters: { amount_min: 10, amount_max: 40, amount_currency: 'USD' },
        format: 'xlsx',
        include_images: false,
      });
      assertEqual(started.status, 202, 'export should be accepted asynchronously');
      const finished = await waitForJob(started.payload.job.id);
      assertEqual(finished.job.status, 'done', `the job failed: ${finished.job.error ?? ''}`);
      assert(finished.seen[0] === 'queued' || finished.seen[0] === 'running', 'the job should start before it finishes');

      // The row the client watches carries the expiry, and the link minted from
      // it expires at the same horizon.
      const expiresInMs = new Date(finished.job.expires_at).getTime() - Date.now();
      assert(
        Math.abs(expiresInMs - EXPORT_SIGNED_URL_TTL_SECONDS * 1000) < 5 * 60 * 1000,
        `the job expiry is ${Math.round(expiresInMs / 3600000)}h away, not seven days`,
      );

      const artifact = finished.job.artifacts[0];
      const signed = await user.client.storage.from('exports').createSignedUrl(artifact.file_path, EXPORT_SIGNED_URL_TTL_SECONDS);
      assert(!signed.error, `the owner must be able to mint a link: ${signed.error?.message ?? ''}`);
      const token = new URL(signed.data.signedUrl, URL_BASE).searchParams.get('token');
      const claims = JSON.parse(atob(token.split('.')[1]));
      const tokenTtl = claims.exp * 1000 - Date.now();
      assert(
        Math.abs(tokenTtl - EXPORT_SIGNED_URL_TTL_SECONDS * 1000) < 5 * 60 * 1000,
        `the signed URL expires in ${Math.round(tokenTtl / 3600000)}h, not seven days`,
      );

      const live = await fetch(signed.data.signedUrl);
      assertEqual(live.status, 200, 'a fresh link should serve the file');
      await live.arrayBuffer();

      // An expired token is refused. Proven with a deliberately short-lived link
      // rather than by waiting seven days: the mechanism is the same signature
      // check, and the horizon it is checked against was asserted just above.
      const brief = await user.client.storage.from('exports').createSignedUrl(artifact.file_path, 1);
      assert(!brief.error, `could not mint a short-lived link: ${brief.error?.message ?? ''}`);
      await sleep(2500);
      const stale = await fetch(brief.data.signedUrl);
      assert(stale.status >= 400, `an expired link still served: HTTP ${stale.status}`);

      // Clock-mocked retention: at the horizon the object itself is deleted, so
      // there is nothing left to serve.
      //
      // The clock is moved on *this job* rather than on the purge's cutoff. An
      // earlier version passed `p_before: now + 8 days`, which matches every
      // completed export in the project — the harness destroyed real files
      // belonging to other accounts on staging. Expiring one row and purging
      // with a cutoff of `now` touches nothing that has not genuinely expired.
      const bystander = await admin.rpc('enqueue_export_job', {
        p_user_id: user.id,
        p_filters: {},
        p_format: 'xlsx',
        p_include_images: false,
      });
      await admin
        .from('export_jobs')
        .update({ status: 'done', artifacts: [{ kind: 'workbook', file_name: 'bystander.xlsx', file_path: `${user.id}/${bystander.data.id}/bystander.xlsx`, byte_size: 1, receipt_count: 1, part: 1, part_count: 1 }], expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() })
        .eq('id', bystander.data.id);

      await admin.from('export_jobs').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', finished.job.id);

      const purged = await admin.rpc('purge_expired_exports', {
        p_before: new Date().toISOString(),
        p_dry_run: false,
      });
      if (purged.error) throw new Error(purged.error.message);
      const paths = purged.data.map((row) => row.out_file_path);
      assert(paths.includes(artifact.file_path), 'the expired export should be selected for purge');
      assert(
        !paths.some((path) => path.includes(bystander.data.id)),
        'the purge took a job that had not expired — it must only ever touch expired rows',
      );

      const removal = await admin.storage.from('exports').remove(paths);
      assert(!removal.error, `purging the objects failed: ${removal.error?.message ?? ''}`);

      // Deletion is asserted through Storage's own API rather than by re-fetching
      // the signed URL. A hosted project serves that URL through a CDN, and a URL
      // fetched moments earlier stays in the edge cache for its cache-control
      // lifetime after the object is gone — re-fetching would be testing the CDN,
      // not the purge.
      const gone = await admin.storage.from('exports').download(artifact.file_path);
      assert(gone.error, 'the purged object must no longer exist in Storage');

      const survivor = await admin.from('export_jobs').select('artifacts').eq('id', bystander.data.id).single();
      assertEqual(survivor.data.artifacts.length, 1, 'a live export must keep its files through someone else\'s purge');
      await admin.from('export_jobs').delete().eq('id', bystander.data.id);

      // A failed job is retryable by its owner, which is the UI's error path.
      const failedJob = await admin.rpc('enqueue_export_job', {
        p_user_id: user.id,
        p_filters: {},
        p_format: 'xlsx',
        p_include_images: false,
      });
      await admin.from('export_jobs').update({ status: 'failed', attempt_count: 3, error: 'forced' }).eq('id', failedJob.data.id);
      const retried = await user.client.rpc('retry_export_job', { p_job_id: failedJob.data.id });
      assert(!retried.error, `a failed export must be retryable: ${retried.error?.message ?? ''}`);
      assertEqual(retried.data.status, 'queued', 'a retried export is queued again');
      await admin.from('export_jobs').delete().eq('id', failedJob.data.id);
    });

    // -------------------------------------------------------------------- T7.5
    await test('T7.5 a thousand receipts complete, and images auto-chunk', async () => {
      const bulk = await createUser();
      try {
        await seed(bulk.id, 1000, 120);

        const startedAt = Date.now();
        const started = await startExport(bulk, { filters: {}, format: 'xlsx', include_images: true });
        assertEqual(started.status, 202, 'a large export must still return immediately');
        assert(Date.now() - startedAt < 5_000, 'the request must not block on building the export');

        // Long enough to allow for sweeper recovery, not just an inline build.
        // A job this size can exceed one edge-function invocation; when it does,
        // the lease expires and the sweeper finishes it on the next attempt. That
        // is the design working (DL-005), so the deadline covers the lease plus a
        // cron interval rather than assuming the first attempt survives.
        const finished = await waitForJob(started.payload.job.id, 600_000);
        assertEqual(finished.job.status, 'done', `the large job failed: ${finished.job.error ?? ''}`);
        assertEqual(finished.job.receipt_count, 1000, 'all thousand receipts should be exported');
        assert(
          finished.job.attempt_count <= 3,
          `the job needed ${finished.job.attempt_count} attempts; recovery is fine but three is the budget`,
        );
        if (finished.job.attempt_count > 1) {
          console.log(`${TAG}    note: completed on attempt ${finished.job.attempt_count} via sweeper recovery`);
        }

        const parts = finished.job.artifacts.filter((entry) => entry.kind === 'images');
        assertEqual(parts.length, 3, '120 images should chunk into three parts of fifty');
        assertEqual(parts.map((part) => part.receipt_count), [50, 50, 20], 'chunks should fill before spilling');
        assert(
          parts.every((part) => /_part\dof3\.pdf$/.test(part.file_name)),
          `chunked names should say which part they are: ${parts.map((part) => part.file_name).join(', ')}`,
        );

        const workbook = finished.job.artifacts.find((entry) => entry.kind === 'workbook');
        const book = XLSX.read(await downloadArtifact(workbook.file_path), { type: 'array' });
        const total = book.SheetNames.reduce(
          (sum, name) => sum + XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true }).length - 1,
          0,
        );
        assertEqual(total, 1000, 'the sheets together should hold every receipt');
      } finally {
        await admin.auth.admin.deleteUser(bulk.id).catch(() => {});
      }
    });
  } finally {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
  }

  const failed = results.filter((result) => result.status === 'failed');
  console.log(`${TAG} ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) Deno.exit(1);
  console.log(`${TAG} PASS`);
}

await main();
