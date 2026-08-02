/**
 * B4 — the extract path over HTTP, as a real signed-in user.
 *
 * verify-b4-db.js proves can_scan() behaves. It does not prove the edge function
 * reaches it, nor that a verdict becomes the right status code on the wire —
 * which is the half that actually broke: "Quota could not be verified" was the
 * function's call into the RPC failing, not the RPC itself.
 *
 * Balanced posts OCR text rather than an image, so the whole path is reachable
 * from a laptop with a string. That closes §6.1, §6.3 and the server half of
 * §6.4 of docs/B4-rate-limit-handover.md without a build on a phone.
 *
 * NOT part of the gate: two of these tests spend a real model call. Run it when
 * the extract functions change, not on every commit.
 *
 * The burst test seeds scan_attempts directly instead of scanning twelve times,
 * so proving the 429 costs nothing. The refusal paths are refused before the
 * model, so they are free too.
 *
 * Run: node scripts/verify-b4-http.js
 */
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b4:http]';
/** Must match v_burst_per_min in the can_scan migration. */
const BURST_PER_MIN = 12;
/** Model calls are slow; the client's own budget is separate from this. */
const REQUEST_TIMEOUT_MS = 90_000;
/** The refund is written by the background persist, after the response returns. */
const REFUND_POLL_MS = 15_000;

// Deliberately ordinary. A receipt the model should have no trouble with, so a
// failure here means the path is broken rather than the image being marginal.
const RECEIPT_TEXT = [
  'BLUE BOTTLE COFFEE',
  '66 Mint St, San Francisco',
  '2026-07-14  10:32',
  'Latte              4.50',
  'Croissant          3.75',
  'Subtotal           8.25',
  'Tax                0.74',
  'TOTAL              8.99',
  'VISA ****4471  APPROVED',
].join('\n');

// Several, because the verdict is the model's and it is not deterministic: the
// first draft of this test used one passage, which was rejected on one run and
// accepted on the next. The refund wiring is asserted on the first explicit
// rejection; if none of these is rejected, that is itself the finding — the
// guardrail is not catching plain non-receipts, and every one of them is a paid
// scan the user keeps being charged for.
const NOT_A_RECEIPT_TEXTS = [
  [
    'CHAPTER ONE',
    'The morning fog had not yet lifted from the harbour when she began walking,',
    'and the gulls overhead made the only sound for a long while. She thought about',
    'the letter in her coat pocket and decided, again, not to read it.',
  ].join('\n'),
  [
    'PLATFORM 4',
    'Departures',
    'Central — on time',
    'Northgate — delayed',
    'Please stand clear of the closing doors.',
  ].join('\n'),
  [
    'This software is provided as is, without warranty of any kind, express or',
    'implied, including but not limited to the warranties of merchantability and',
    'fitness for a particular purpose.',
  ].join('\n'),
];

// -------------------------------------------------------------- test plumbing

const results = [];
let currentChecks = 0;

function assert(condition, message) {
  currentChecks += 1;
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function test(name, fn) {
  currentChecks = 0;
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, checks: currentChecks });
    console.log(`${TAG} PASS ${name} (${currentChecks} checks, ${Date.now() - startedAt}ms)`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`${TAG} FAIL ${name}\n        ${error.message}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ----------------------------------------------------------------- the client

function makeExtractClient({ url, anonKey, accessToken }) {
  return async function post(body) {
    const response = await fetch(`${url}/functions/v1/extract-balanced`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Leave json null; the assertion message carries the raw body.
    }
    return { status: response.status, json, raw: text.slice(0, 400) };
  };
}

/** A capture the server will accept as well-formed. */
function scanBody(extractedText, mode = 'default') {
  return {
    capture_id: randomUUID(),
    mode,
    captured_at: new Date().toISOString(),
    extracted_text: extractedText,
    default_currency: 'USD',
  };
}

// --------------------------------------------------------------------- suites

async function suite({ post, pg, userId }) {
  const one = async (text, params) => (await pg.query(text, params)).rows[0];
  const setBalance = async (balance) => {
    await pg.query('delete from public.scan_ledger where user_id = $1', [userId]);
    if (balance !== 0) {
      await pg.query(
        `insert into public.scan_ledger (user_id, delta, reason, ref_id)
         values ($1, $2, 'admin', gen_random_uuid())`,
        [userId, balance],
      );
    }
  };
  const clearAttempts = () => pg.query('delete from public.scan_attempts where user_id = $1', [userId]);
  const countByReason = async (reason, refId = null) =>
    (
      await one(
        `select count(*)::int as n from public.scan_ledger
          where user_id = $1 and reason = $2::ledger_reason
            and ($3::uuid is null or ref_id = $3::uuid)`,
        [userId, reason, refId],
      )
    ).n;

  await test('the function boots and accepts an authenticated warm-up', async () => {
    await clearAttempts();
    await setBalance(5);
    const { status, json, raw } = await post({ warm_up: true });
    assertEqual(status, 200, `warm-up status (body: ${raw})`);
    assertEqual(json?.warm, true, 'warm-up acknowledged');
    // A warm-up must not touch quota, or the camera opening would cost a scan.
    assertEqual(await countByReason('scan_used'), 0, 'warm-up did not charge a scan');
  });

  await test('a real scan completes end to end and lands one scan_used row', async () => {
    await clearAttempts();
    await setBalance(5);

    const body = scanBody(RECEIPT_TEXT);
    const { status, json, raw } = await post(body);

    // This is the assertion the whole handover was waiting on: a 500 with
    // "Quota could not be verified" here means the edge function still cannot
    // reach can_scan, whatever the database harness says.
    assertEqual(status, 200, `scan status (body: ${raw})`);
    assert(json?.receipt_id, 'a committed receipt_id came back');
    assertEqual(json?.result?.is_receipt, true, 'the model recognised the receipt');
    // Charged at decision time, before the model — so it is already there.
    assertEqual(await countByReason('scan_used', body.capture_id), 1, 'exactly one charge for this capture');
    assertEqual(await countByReason('refund', body.capture_id), 0, 'a good scan is not refunded');
  });

  await test('a non-receipt is rejected and the scan is refunded', async () => {
    await clearAttempts();
    await setBalance(5);

    let body = null;
    const verdicts = [];
    for (const text of NOT_A_RECEIPT_TEXTS) {
      const candidate = scanBody(text);
      const { status, json, raw } = await post(candidate);
      assertEqual(status, 200, `rejection status (body: ${raw})`);
      verdicts.push(json?.result?.is_receipt);
      if (json?.result?.is_receipt === false) {
        body = candidate;
        break;
      }
    }

    assert(
      body !== null,
      `the model accepted all ${NOT_A_RECEIPT_TEXTS.length} non-receipts (is_receipt: ${verdicts.join(', ')}). ` +
        'Nothing is refunded without an explicit false, and extract-balanced defaults a missing ' +
        'is_receipt to true, so each of these is a scan charged for a non-receipt.',
    );
    assertEqual(await countByReason('scan_used', body.capture_id), 1, 'it was charged before the model ran');

    // The refund is written by the background persist, after the response.
    const deadline = Date.now() + REFUND_POLL_MS;
    let refunds = 0;
    while (Date.now() < deadline) {
      refunds = await countByReason('refund', body.capture_id);
      if (refunds > 0) break;
      await sleep(500);
    }
    assertEqual(refunds, 1, `a refund row appeared within ${REFUND_POLL_MS}ms`);
    // Net zero for this capture specifically. The overall balance is not
    // asserted, because any earlier candidate the model waved through was
    // charged and not refunded — which is the point of the assertion above.
    assertEqual(
      (
        await one('select coalesce(sum(delta),0)::int as n from public.scan_ledger where user_id = $1 and ref_id = $2', [
          userId,
          body.capture_id,
        ])
      ).n,
      0,
      'the charge and the refund cancel out for this capture',
    );
  });

  await test('an out-of-scans user gets 402 with a paywall, not a 500', async () => {
    await clearAttempts();
    await setBalance(0);

    const { status, json, raw } = await post(scanBody(RECEIPT_TEXT));
    assertEqual(status, 402, `status (body: ${raw})`);
    assertEqual(json?.code, 'QUOTA_EXHAUSTED', 'error code');
    assertEqual(json?.paywall, 'plus', 'a free user is sold Plus');
    assertEqual(await countByReason('scan_used'), 0, 'refused before the model, so nothing was charged');
  });

  await test('a throttled user gets 429 RATE_LIMITED, not 402', async () => {
    await setBalance(5);
    // Seeded rather than scanned twelve times: the burst is a count of rows in
    // the last minute, so filling it directly proves the same thing for free.
    await clearAttempts();
    await pg.query(
      `insert into public.scan_attempts (user_id)
       select $1 from generate_series(1, $2)`,
      [userId, BURST_PER_MIN],
    );

    const { status, json, raw } = await post(scanBody(RECEIPT_TEXT));
    // 429 is what makes the client queue and retry silently; 402 would show a
    // paywall to someone who has scans left and was merely too fast.
    assertEqual(status, 429, `status (body: ${raw})`);
    assertEqual(json?.code, 'RATE_LIMITED', 'error code');
    assertEqual(json?.retry_after_s, 60, 'retry_after_s');
    assertEqual(await countByReason('scan_used'), 0, 'a throttled scan is never charged');
  });
}

// ----------------------------------------------------------------------- main

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);

  console.log(`${TAG} target ${projectRef(config.url)} — 2 of 5 tests spend a real model call`);

  try {
    await withUser(admin, async ({ userId, email, password }) => {
      // Sign in as the user rather than reusing the service role: the function
      // authenticates the caller's JWT, and service_role would not exercise it.
      const anon = createClient(config.url, config.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`could not sign in as the test user: ${error.message}`);

      const post = makeExtractClient({
        url: config.url,
        anonKey: config.anonKey,
        accessToken: data.session.access_token,
      });
      await suite({ post, pg, userId });
    }, pg);
  } finally {
    await pg.end();
  }

  const failed = results.filter((result) => !result.ok);
  const checks = results.reduce((sum, result) => sum + (result.checks ?? 0), 0);

  if (failed.length > 0) {
    console.error(`${TAG} ${failed.length} of ${results.length} tests failed`);
    process.exit(1);
  }

  console.log(`${TAG} extract-balanced verified over HTTP — ${results.length} tests, ${checks} checks`);
}

main().catch((error) => {
  console.error(`${TAG} ${error.message}`);
  process.exit(1);
});
