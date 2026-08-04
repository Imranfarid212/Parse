/**
 * B5 - staging HTTP verification for the Provider Delay response and worker.
 *
 * Requires the staging-only RF_B5_TEST_FORCE_GROK_FAILURE and
 * RF_B5_TEST_USE_FIXTURE flags to be set to 1. Both are reset after the run.
 *
 * Run: node scripts/verify-b5-http.js
 */
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b5:http]';
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 400;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A tiny JPEG is enough to exercise multipart parsing, storage and the worker;
// the worker fixture makes image content deliberately irrelevant in this run.
const TEST_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z', 'base64');

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const originalBreaker = (await pg.query('select * from public.provider_state where id = 1')).rows[0];
  console.log(`${TAG} target ${projectRef(config.url)}`);

  try {
    await withUser(admin, async ({ userId, email, password }) => {
      await pg.query("update public.provider_state set state = 'closed', consecutive_failures = 0, opened_at = null where id = 1");
      await pg.query(
        "insert into public.scan_ledger (user_id, delta, reason, ref_id) values ($1, 3, 'admin', gen_random_uuid())",
        [userId],
      );

      const client = createClient(config.url, config.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(`could not sign in: ${signInError.message}`);

      const deviceId = randomUUID();
      const { data: claimData, error: claimError } = await client.rpc('claim_user_device', {
        p_device_id: deviceId,
        p_takeover: false,
      });
      if (claimError) throw new Error(`claim_user_device: ${claimError.message}`);
      assert((Array.isArray(claimData) ? claimData[0] : claimData)?.out_status === 'active', 'test device was not activated');

      const captureId = randomUUID();
      const body = new FormData();
      body.set('capture_id', captureId);
      body.set('mode', 'default');
      body.set('extraction_mode', 'precise');
      body.set('captured_at', new Date().toISOString());
      body.set('image', new Blob([TEST_JPEG], { type: 'image/jpeg' }), 'b5-verify.jpg');

      const response = await fetch(`${config.url}/functions/v1/extract`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signedIn.session.access_token}`,
          apikey: config.anonKey,
          'x-rf-device-id': deviceId,
          'x-rf-force-provider-failure': '1',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => null);
      assert(response.status === 202, `expected 202, got ${response.status}: ${JSON.stringify(payload)}`);
      assert(payload?.code === 'PROVIDER_DELAY', `expected PROVIDER_DELAY, got ${payload?.code}`);
      assert(payload?.receipt_id, '202 response has no receipt_id');
      assert(payload?.acked_at, '202 response has no acked_at');

      const initial = (await pg.query(
        `select r.status::text as receipt_status, j.status::text as job_status
           from public.receipts r join public.extraction_jobs j on j.receipt_id = r.id
          where r.id = $1`,
        [payload.receipt_id],
      )).rows[0];
      assert(initial, '202 did not commit a receipt/job pair');

      let completed = null;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const row = (await pg.query(
          `select r.status::text as receipt_status, r.provider::text as provider,
                  r.merchant, j.status::text as job_status
             from public.receipts r join public.extraction_jobs j on j.receipt_id = r.id
            where r.id = $1`,
          [payload.receipt_id],
        )).rows[0];
        if (row?.job_status === 'done') {
          completed = row;
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      assert(completed, `worker did not complete within ${POLL_TIMEOUT_MS}ms`);
      assert(completed.receipt_status === 'needs_review', `expected needs_review, got ${completed.receipt_status}`);
      assert(completed.provider === 'gemini', `expected Gemini continuation, got ${completed.provider}`);
      assert(completed.merchant === 'Whole Foods Market', `fixture result missing, got ${completed.merchant}`);
      console.log(`${TAG} PASS 202 PROVIDER_DELAY committed and Gemini continuation completed`);
    }, pg);
  } finally {
    if (originalBreaker) {
      await pg.query(
        `update public.provider_state
            set state = $2, consecutive_failures = $3, opened_at = $4, last_probe_at = $5, updated_at = $6
          where id = $1`,
        [originalBreaker.id, originalBreaker.state, originalBreaker.consecutive_failures, originalBreaker.opened_at, originalBreaker.last_probe_at, originalBreaker.updated_at],
      );
    }
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
});
