/** Verifies OPEN routes a Precise scan synchronously to Gemini with no job row. */
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b5:breaker]';
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z', 'base64');

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const original = (await pg.query('select * from public.provider_state where id = 1')).rows[0];
  try {
    await withUser(admin, async ({ userId, email, password }) => {
      await pg.query("update public.provider_state set state = 'open', consecutive_failures = 3, opened_at = now(), updated_at = now() where id = 1");
      await pg.query("insert into public.scan_ledger (user_id, delta, reason, ref_id) values ($1, 2, 'admin', gen_random_uuid())", [userId]);
      const client = createClient(config.url, config.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      const deviceId = randomUUID();
      const { error: deviceError } = await client.rpc('claim_user_device', { p_device_id: deviceId, p_takeover: false });
      if (deviceError) throw deviceError;
      const captureId = randomUUID();
      const body = new FormData();
      body.set('capture_id', captureId);
      body.set('mode', 'default');
      body.set('extraction_mode', 'precise');
      body.set('captured_at', new Date().toISOString());
      body.set('image', new Blob([JPEG], { type: 'image/jpeg' }), 'breaker.jpg');
      const response = await fetch(`${config.url}/functions/v1/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${signedIn.session.access_token}`, apikey: config.anonKey, 'x-rf-device-id': deviceId },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => null);
      if (response.status !== 200) throw new Error(`expected 200, got ${response.status}: ${JSON.stringify(payload)}`);
      if (!payload?.receipt_id || payload?.code === 'PROVIDER_DELAY') throw new Error(`expected synchronous response: ${JSON.stringify(payload)}`);
      const row = (await pg.query(
        `select r.provider::text as provider, r.status::text as status,
                exists(select 1 from public.extraction_jobs j where j.receipt_id = r.id) as has_job
           from public.receipts r where r.id = $1`,
        [payload.receipt_id],
      )).rows[0];
      if (row?.provider !== 'gemini' || row?.has_job || row?.status !== 'needs_review') {
        throw new Error(`unexpected persisted fallback: ${JSON.stringify(row)}`);
      }
      console.log(`${TAG} PASS OPEN -> synchronous Gemini 200 with no durable job on ${projectRef(config.url)}`);
    }, pg);
  } finally {
    if (original) await pg.query(
      'update public.provider_state set state = $2, consecutive_failures = $3, opened_at = $4, last_probe_at = $5, updated_at = $6 where id = $1',
      [original.id, original.state, original.consecutive_failures, original.opened_at, original.last_probe_at, original.updated_at],
    );
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`${TAG} FAIL ${error.message}`);
  process.exitCode = 1;
});
