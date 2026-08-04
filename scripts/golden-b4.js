/**
 * T4.2 — the golden accuracy + latency run.
 *
 * T4.2's product latency gate is now mode-specific:
 *
 *  - Balanced: the 20-receipt live golden set must average <=2.5 s from host
 *    dispatch to response. p50/p95/max remain diagnostics.
 *  - Precise: the app's end-to-end `total_to_ui_ms` must average <=4.5 s in a
 *    physical image-path run. This text-only harness cannot honestly measure
 *    that Grok path, so the operator supplies the physical-device result when
 *    invoking the report.
 *
 * The playbook's old p50 <=1.6 s criterion is retired because it does not match
 * the selected Balanced/Precise product behavior.
 *
 * What this measures, and what it does not
 * ----------------------------------------
 * This is a scripted host-side run, so the clock starts at dispatch, not at the
 * shutter. It cannot see camera latency, on-device compression, OCR, or the
 * render of the card. So the latency assertion here is a NECESSARY condition,
 * not the playbook's full one: if the server round trip alone does not fit in
 * 2.5 s on average, tap-to-card cannot either. The report says so in `latency.scope` and
 * carries `tap_to_card: null` rather than a number nobody measured. The
 * physical Precise result is supplied separately from the device run.
 *
 * Deliberate choices worth keeping
 * --------------------------------
 *  - Duplicate detection stays ON. It is ~400 ms of the production path
 *    (see docs/B4-pending.md §4); switching it off with `duplicate_override`
 *    would make this run faster than the thing it claims to measure.
 *  - `scan_attempts` is cleared between samples. 20 scans would trip the 12/min
 *    burst limit, and this run must not end up measuring the rate limiter —
 *    that is T4.3's job, tested there against the real function.
 *  - The throwaway user is given a strict SUBSET of the seeded categories, so
 *    "category is from the user's list or Miscellaneous" is a claim that can
 *    actually fail. Offer all ten and the fallback is never exercised.
 *  - `is_receipt` is not deterministic (docs/B4-pending.md §4), so accuracy is
 *    asserted over the 20-set aggregate, never per-receipt.
 *
 * Spends 20 model calls per run against whatever project .env.staging names.
 *
 * Run: node scripts/golden-b4.js [--precise-average-ms N] [--precise-samples N]
 *   [--samples N] [--out gates/report-b4-golden.json]
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');
const { sourceFingerprint } = require('./lib/golden-fingerprint');
const {
  THRESHOLDS,
  OFFERED_CATEGORY_IDS,
  GOLDEN,
  normalizeMerchant,
  casefold,
  money,
} = require('./lib/golden-set');

const root = path.resolve(__dirname, '..');

/** Best effort: the report is still valid without it, the fingerprint is the real guard. */
function head() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    samples: GOLDEN.length,
    out: 'gates/report-b4-golden.json',
    preciseAverageMs: null,
    preciseSamples: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--samples') args.samples = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--precise-average-ms') args.preciseAverageMs = Number(argv[++i]);
    else if (argv[i] === '--precise-samples') args.preciseSamples = Number(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(args.samples) || args.samples < 1 || args.samples > GOLDEN.length) {
    throw new Error(`--samples must be between 1 and ${GOLDEN.length}`);
  }
  if (args.preciseAverageMs != null && (!Number.isFinite(args.preciseAverageMs) || args.preciseAverageMs < 0)) {
    throw new Error('--precise-average-ms must be a non-negative number');
  }
  if (args.preciseSamples != null && (!Number.isInteger(args.preciseSamples) || args.preciseSamples < 1)) {
    throw new Error('--precise-samples must be a positive integer');
  }
  if ((args.preciseAverageMs == null) !== (args.preciseSamples == null)) {
    throw new Error('--precise-average-ms and --precise-samples must be supplied together');
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const cases = GOLDEN.slice(0, args.samples);

  console.log(
    `[golden] ${projectRef(config.url)} — ${cases.length} receipts, one model call each, duplicate check live\n`,
  );

  let report;
  try {
    report = await withUser(
      admin,
      async ({ userId, email, password }) => {
        const anon = createClient(config.url, config.anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data, error } = await anon.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`sign in: ${error.message}`);
        const token = data.session.access_token;
        const deviceId = randomUUID();
        const { data: claim, error: claimError } = await anon.rpc('claim_user_device', {
          p_device_id: deviceId,
          p_takeover: false,
        });
        if (claimError) throw new Error(`claim golden-run device: ${claimError.message}`);
        if (claim?.[0]?.out_status !== 'active') {
          throw new Error(`claim golden-run device: expected active, got ${claim?.[0]?.out_status ?? 'null'}`);
        }

        // A strict subset, so the Miscellaneous fallback is reachable.
        await pg.query('delete from public.user_categories where user_id = $1', [userId]);
        await pg.query(
          `insert into public.user_categories (user_id, category_id, sort_order)
           select $1, id, ord from unnest($2::int[]) with ordinality as t(id, ord)`,
          [userId, OFFERED_CATEGORY_IDS],
        );
        const { rows: offeredRows } = await pg.query(
          'select name from public.categories where id = any($1::int[]) order by id',
          [OFFERED_CATEGORY_IDS],
        );
        const offered = offeredRows.map((row) => row.name);
        console.log(`[golden] offered categories: ${offered.join(', ')}\n`);

        // Plenty of balance so nothing is refused for quota.
        await pg.query('delete from public.scan_ledger where user_id = $1', [userId]);
        await pg.query(
          `insert into public.scan_ledger (user_id, delta, reason, ref_id)
           values ($1, 500, 'admin', gen_random_uuid())`,
          [userId],
        );

        const samples = [];
        for (const [index, testCase] of cases.entries()) {
          // Not measuring the rate limiter — see the header.
          await pg.query('delete from public.scan_attempts where user_id = $1', [userId]);

          const startedAt = Date.now();
          let response;
          let body = null;
          try {
            response = await fetch(`${config.url}/functions/v1/extract-balanced`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                apikey: config.anonKey,
                'Content-Type': 'application/json',
                'x-rf-device-id': deviceId,
              },
              body: JSON.stringify({
                capture_id: randomUUID(),
                mode: 'default',
                captured_at: new Date().toISOString(),
                extracted_text: testCase.text,
                default_currency: testCase.expect.currency,
              }),
              signal: AbortSignal.timeout(90_000),
            });
            body = await response.json().catch(() => null);
          } catch (fetchError) {
            samples.push({
              id: testCase.id,
              status: null,
              transport_error: String(fetchError?.message ?? fetchError),
              round_trip_ms: Date.now() - startedAt,
            });
            console.log(`#${String(index + 1).padStart(2)} ${testCase.id}  TRANSPORT FAILED`);
            continue;
          }

          const roundTripMs = Date.now() - startedAt;
          const result = body?.result ?? null;
          const got = {
            merchant: result?.merchant ?? null,
            txn_date: result?.txn_date ?? null,
            total: result?.total ?? null,
            currency: result?.currency ?? null,
            suggested_category: result?.suggested_category ?? null,
            is_receipt: result?.is_receipt ?? null,
          };
          const match = {
            merchant: normalizeMerchant(got.merchant) === normalizeMerchant(testCase.expect.merchant),
            merchant_strict: casefold(got.merchant) === casefold(testCase.expect.merchant),
            txn_date: got.txn_date === testCase.expect.txn_date,
            total: money(got.total) !== null && money(got.total) === money(testCase.expect.total),
            currency: got.currency === testCase.expect.currency,
            // The one the server, not the model, is responsible for.
            category_in_list: got.suggested_category != null && offered.includes(got.suggested_category),
          };

          samples.push({
            id: testCase.id,
            status: response.status,
            round_trip_ms: roundTripMs,
            server_total_ms: body?.timing?.total_ms ?? null,
            server_model_ms: body?.timing?.model_ms ?? null,
            duplicate_ms: body?.timing?.duplicate_ms ?? null,
            expected: testCase.expect,
            got,
            match,
          });

          const flag = (ok) => (ok ? '.' : 'X');
          console.log(
            `#${String(index + 1).padStart(2)} ${testCase.id.padEnd(28)} ${response.status}` +
              `  m${flag(match.merchant)} d${flag(match.txn_date)} t${flag(match.total)} c${flag(match.currency)}` +
              `  cat ${String(got.suggested_category ?? '-').padEnd(22)}` +
              `  ${String(roundTripMs).padStart(5)} ms`,
          );
        }

        return { userId, email, offered, samples };
      },
      pg,
    );
  } finally {
    await pg.end();
  }

  const { offered, samples } = report;
  const scored = samples.filter((s) => s.status === 200 && s.got);
  const rate = (field) => (scored.length === 0 ? 0 : scored.filter((s) => s.match[field]).length / scored.length);
  const latencies = scored.map((s) => s.round_trip_ms).sort((a, b) => a - b);

  const accuracy = {
    scored: scored.length,
    attempted: samples.length,
    merchant: rate('merchant'),
    merchant_strict: rate('merchant_strict'), // recorded for audit, not a threshold
    txn_date: rate('txn_date'),
    total: rate('total'),
    currency: rate('currency'),
    category_in_list: rate('category_in_list'),
  };
  const latency = {
    // Say what this number is, so the report cannot be read as the device run.
    scope: 'server_round_trip_from_host',
    note: 'Dispatch to response. Excludes camera, compression, OCR and card render. Necessary condition for tap-to-card, not equal to it.',
    average_ms: latencies.length === 0 ? null : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    max_ms: latencies.at(-1) ?? null,
    tap_to_card_p50_ms: null, // owed by the device leg
  };

  const productAcceptance = {
    balanced: {
      metric: 'server_round_trip_average_ms',
      threshold_ms: THRESHOLDS.balancedAverageRoundTripMs,
      automated_by: 'this 20-case live golden run',
    },
    precise: {
      metric: 'total_to_ui_ms',
      threshold_ms: THRESHOLDS.preciseAverageToUiMs,
      average_ms: args.preciseAverageMs,
      samples: args.preciseSamples,
      evidence: args.preciseAverageMs == null
        ? 'physical-device image-path run required; this text harness does not call Grok'
        : 'operator-supplied physical-device image-path run',
    },
  };

  const checks = [
    ['merchant exact >= 90%', accuracy.merchant >= THRESHOLDS.fieldAccuracy, accuracy.merchant],
    ['txn_date exact >= 90%', accuracy.txn_date >= THRESHOLDS.fieldAccuracy, accuracy.txn_date],
    ['total exact >= 90%', accuracy.total >= THRESHOLDS.fieldAccuracy, accuracy.total],
    ['category always in list', accuracy.category_in_list >= THRESHOLDS.categoryInList, accuracy.category_in_list],
    [
      `Balanced average round-trip <= ${THRESHOLDS.balancedAverageRoundTripMs} ms`,
      latency.average_ms != null && latency.average_ms <= THRESHOLDS.balancedAverageRoundTripMs,
      latency.average_ms,
    ],
    [
      `Precise physical average total_to_ui <= ${THRESHOLDS.preciseAverageToUiMs} ms`,
      args.preciseAverageMs != null && args.preciseAverageMs <= THRESHOLDS.preciseAverageToUiMs,
      args.preciseAverageMs,
    ],
    ['every sample answered', scored.length === samples.length, scored.length],
    // A short run is useful while iterating and is not evidence for the gate.
    ['full 20-receipt set', cases.length === GOLDEN.length, cases.length],
  ];

  const passed = checks.every(([, ok]) => ok);
  const out = {
    test: 'T4.2-golden-latency',
    project: projectRef(config.url),
    ran_at: new Date().toISOString(),
    commit_sha: process.env.GITHUB_SHA ?? head(),
    // How the gate knows this report still describes the code in the tree.
    source_fingerprint: sourceFingerprint(),
    status: passed ? 'passed' : 'failed',
    // The physical result is supplied from the device run because this
    // harness deliberately calls only the Balanced text endpoint.
    device_run_required: args.preciseAverageMs == null,
    thresholds: THRESHOLDS,
    product_acceptance: productAcceptance,
    offered_categories: offered,
    accuracy,
    latency,
    checks: checks.map(([label, ok, value]) => ({ label, ok, value })),
    samples,
  };

  // resolve, not join: an absolute --out belongs where it points, not nested
  // under the repo root.
  const outPath = path.resolve(root, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  console.log('\n--- T4.2 golden run ---');
  console.log(`  merchant   ${pct(accuracy.merchant)}   (raw string match ${pct(accuracy.merchant_strict)})`);
  console.log(`  txn_date   ${pct(accuracy.txn_date)}`);
  console.log(`  total      ${pct(accuracy.total)}`);
  console.log(`  currency   ${pct(accuracy.currency)}   (recorded, not a T4.2 threshold)`);
  console.log(`  category   ${pct(accuracy.category_in_list)} in the offered list`);
  console.log(`  round trip avg ${latency.average_ms} ms  p50 ${latency.p50_ms} ms  p95 ${latency.p95_ms} ms  max ${latency.max_ms} ms`);
  for (const [label, ok, value] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  (${value})`);
  console.log(`\n  report written to ${args.out}`);
  if (args.preciseAverageMs == null) {
    console.log('  NOTE supply --precise-average-ms and --precise-samples from the physical image-path run.');
  } else {
    console.log(`  Precise physical average ${args.preciseAverageMs} ms over ${args.preciseSamples} samples`);
  }

  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error(`[golden] ${error.message}`);
  process.exit(1);
});
