/**
 * T5.5 — live Gemini image-fallback accuracy run against deterministic,
 * rendered receipt images. This is vision-path evidence, but deliberately not
 * a substitute for a camera-photo corpus.
 *
 * Run: node scripts/golden-b5-gemini.js [--samples N] [--offset N] [--images DIR] [--out PATH]
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');
const { THRESHOLDS, OFFERED_CATEGORY_IDS, GOLDEN, normalizeMerchant, casefold, money } = require('./lib/golden-set');

const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { samples: GOLDEN.length, offset: 0, images: 'tmp/b5-synthetic-golden', out: 'tmp/report-b5-gemini-synthetic.json', allowPartial: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--samples') args.samples = Number(argv[++i]);
    else if (argv[i] === '--offset') args.offset = Number(argv[++i]);
    else if (argv[i] === '--images') args.images = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--allow-partial') args.allowPartial = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(args.samples) || args.samples < 1 || !Number.isInteger(args.offset) || args.offset < 0 || args.offset + args.samples > GOLDEN.length) {
    throw new Error(`--offset and --samples must select between 1 and ${GOLDEN.length} cases`);
  }
  return args;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function recordedProvider(pg, receiptId) {
  if (!receiptId) return null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = (await pg.query('select provider::text as provider from public.receipts where id = $1', [receiptId])).rows[0];
    if (row?.provider) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const images = path.resolve(root, args.images);
  const cases = GOLDEN.slice(args.offset, args.offset + args.samples);
  for (const testCase of cases) {
    if (!fs.existsSync(path.join(images, `${testCase.id}.jpg`))) {
      throw new Error(`missing ${testCase.id}.jpg; run npm run b5:gemini:fixtures first`);
    }
  }
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const originalState = (await pg.query('select * from public.provider_state where id = 1')).rows[0];
  let result;
  try {
    result = await withUser(admin, async ({ userId, email, password }) => {
      // OPEN is intentional: every request takes the synchronous Gemini image
      // path, with no worker or test fixture shortcut involved.
      await pg.query(
        "update public.provider_state set state = 'open', consecutive_failures = 3, opened_at = now(), updated_at = now() where id = 1",
      );
      await pg.query('delete from public.user_categories where user_id = $1', [userId]);
      await pg.query(
        `insert into public.user_categories (user_id, category_id, sort_order)
         select $1, id, ord from unnest($2::int[]) with ordinality as t(id, ord)`,
        [userId, OFFERED_CATEGORY_IDS],
      );
      await pg.query("insert into public.scan_ledger (user_id, delta, reason, ref_id) values ($1, 100, 'admin', gen_random_uuid())", [userId]);
      const client = createClient(config.url, config.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      const deviceId = randomUUID();
      const { error: deviceError } = await client.rpc('claim_user_device', { p_device_id: deviceId, p_takeover: false });
      if (deviceError) throw deviceError;
      const { rows: offeredRows } = await pg.query('select name from public.categories where id = any($1::int[]) order by id', [OFFERED_CATEGORY_IDS]);
      const offered = offeredRows.map((row) => row.name);
      const samples = [];
      for (const [index, testCase] of cases.entries()) {
        await pg.query('delete from public.scan_attempts where user_id = $1', [userId]);
        // The staging provider probe runs independently every 15 minutes. Set
        // this again per request so its successful canary cannot turn a forced
        // Gemini sample back into a Grok request mid-run.
        await pg.query(
          "update public.provider_state set state = 'open', consecutive_failures = 3, opened_at = now(), updated_at = now() where id = 1",
        );
        const body = new FormData();
        body.set('capture_id', randomUUID());
        body.set('mode', 'default');
        body.set('extraction_mode', 'precise');
        body.set('captured_at', new Date().toISOString());
        body.set('image', new Blob([fs.readFileSync(path.join(images, `${testCase.id}.jpg`))], { type: 'image/jpeg' }), `${testCase.id}.jpg`);
        const startedAt = Date.now();
        const response = await fetch(`${config.url}/functions/v1/extract`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${signedIn.session.access_token}`, apikey: config.anonKey, 'x-rf-device-id': deviceId },
          body,
          signal: AbortSignal.timeout(90_000),
        });
        const payload = await response.json().catch(() => null);
        const roundTripMs = Date.now() - startedAt;
        const got = payload?.result ?? null;
        const persisted = await recordedProvider(pg, payload?.receipt_id);
        const durableJob = payload?.receipt_id && response.status === 202
          ? (await pg.query('select provider_attempted, last_error from public.extraction_jobs where receipt_id = $1', [payload.receipt_id])).rows[0]
          : null;
        const match = {
          merchant: normalizeMerchant(got?.merchant) === normalizeMerchant(testCase.expect.merchant),
          merchant_strict: casefold(got?.merchant) === casefold(testCase.expect.merchant),
          txn_date: got?.txn_date === testCase.expect.txn_date,
          total: money(got?.total) === money(testCase.expect.total),
          currency: got?.currency === testCase.expect.currency,
          category_in_list: got?.suggested_category != null && offered.includes(got.suggested_category),
          provider: persisted?.provider === 'gemini',
        };
        samples.push({ id: testCase.id, status: response.status, round_trip_ms: roundTripMs, expected: testCase.expect, got, persisted_provider: persisted?.provider ?? null, durable_error: durableJob?.last_error ?? null, match, payload_code: payload?.code ?? null });
        const flag = (ok) => (ok ? '.' : 'X');
        console.log(`#${String(index + 1).padStart(2)} ${testCase.id.padEnd(28)} ${response.status}  m${flag(match.merchant)} d${flag(match.txn_date)} t${flag(match.total)} p${flag(match.provider)}  ${roundTripMs} ms`);
      }
      return { offered, samples };
    }, pg);
  } finally {
    if (originalState) {
      await pg.query(
        'update public.provider_state set state = $2, consecutive_failures = $3, opened_at = $4, last_probe_at = $5, updated_at = $6 where id = $1',
        [originalState.id, originalState.state, originalState.consecutive_failures, originalState.opened_at, originalState.last_probe_at, originalState.updated_at],
      );
    }
    await pg.end();
  }
  const scored = result.samples.filter((sample) => sample.status === 200 && sample.got);
  const rate = (field) => scored.length ? scored.filter((sample) => sample.match[field]).length / scored.length : 0;
  const latencies = scored.map((sample) => sample.round_trip_ms).sort((a, b) => a - b);
  const accuracy = { attempted: result.samples.length, scored: scored.length, merchant: rate('merchant'), merchant_strict: rate('merchant_strict'), txn_date: rate('txn_date'), total: rate('total'), currency: rate('currency'), category_in_list: rate('category_in_list'), provider_recorded: rate('provider') };
  const checks = [
    ['merchant exact >= 90%', accuracy.merchant >= THRESHOLDS.fieldAccuracy, accuracy.merchant],
    ['txn_date exact >= 90%', accuracy.txn_date >= THRESHOLDS.fieldAccuracy, accuracy.txn_date],
    ['total exact >= 90%', accuracy.total >= THRESHOLDS.fieldAccuracy, accuracy.total],
    ['category always in list', accuracy.category_in_list >= THRESHOLDS.categoryInList, accuracy.category_in_list],
    ['Gemini recorded for every image fallback', accuracy.provider_recorded === 1, accuracy.provider_recorded],
    ['every sample answered', scored.length === result.samples.length, scored.length],
    ...(args.allowPartial ? [] : [['full 20-receipt set', result.samples.length === GOLDEN.length, result.samples.length]]),
  ];
  const report = {
    test: 'T5.5-forced-gemini-synthetic-vision-golden',
    project: projectRef(config.url),
    ran_at: new Date().toISOString(),
    corpus: 'synthetic rendered receipt text; does not measure camera-photo robustness',
    range: { offset: args.offset, samples: args.samples, full_set: result.samples.length === GOLDEN.length },
    thresholds: THRESHOLDS,
    offered_categories: result.offered,
    accuracy,
    latency: { scope: 'server_round_trip_from_host', average_ms: latencies.length ? Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length) : null, p50_ms: percentile(latencies, 50), p95_ms: percentile(latencies, 95), max_ms: latencies.at(-1) ?? null },
    checks: checks.map(([label, ok, value]) => ({ label, ok, value })),
    samples: result.samples,
    status: checks.every(([, ok]) => ok) ? 'passed' : 'failed',
  };
  const output = path.resolve(root, args.out);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n[b5:gemini] ${report.status.toUpperCase()} - ${output}`);
  for (const [label, ok, value] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label} (${value})`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[b5:gemini] FAIL ${error.message}`);
  process.exitCode = 1;
});
