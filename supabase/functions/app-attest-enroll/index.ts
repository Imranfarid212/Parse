// @ts-nocheck - Supabase Edge Functions run under Deno, outside Expo's tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { isActiveDevice, isDeviceId } from '../_shared/device.ts';
import { normalizeReferralCode } from '../_shared/referrals.ts';
import { randomChallenge, sha256Hex } from '../_shared/app-attest-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const keyIdIsValid = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 32 && value.length <= 256 && /^[A-Za-z0-9+/_=-]+$/.test(value);

/** Bounded to the column width so a chatty client cannot widen a row. */
const stringOrNull = (value: unknown, maxLength: number) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
};

const challengeContext = (body: Record<string, unknown>) => {
  if (body.purpose === 'enroll') return { purpose: 'enroll' as const, context: {} };
  if (body.purpose !== 'referral_redeem') throw new Error('Invalid verification purpose.');
  const code = normalizeReferralCode(body.code);
  const entryMethod = body.entry_method;
  if (!code || (entryMethod !== 'code' && entryMethod !== 'link')) throw new Error('Invalid referral verification context.');
  return { purpose: 'referral_redeem' as const, context: { code, entry_method: entryMethod } };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST required' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { code: 'CONFIGURATION_ERROR', message: 'Device verification is not configured.' });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json(401, { code: 'UNAUTHORIZED', message: 'Sign in required.' });
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return json(401, { code: 'UNAUTHORIZED', message: 'Sign in required.' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { code: 'VALIDATION_FAILED', message: 'A JSON body is required.' }); }
  // Every action but a failure report is about one specific key. A report can
  // come from Android, which has no App Attest key at all, or from a failure in
  // generateKeyAsync itself — so there the identifier is optional, and checked
  // only when it is supplied.
  const keyIdOptional = body.action === 'report_failure';
  const keyIdAcceptable = (keyIdOptional && body.key_id == null) || keyIdIsValid(body.key_id);
  if (body.user_id !== userId || !isDeviceId(body.device_id) || !keyIdAcceptable) {
    return json(400, { code: 'VALIDATION_FAILED', message: 'Device verification request is invalid.' });
  }

  const deviceId = body.device_id as string;
  const keyId = keyIdIsValid(body.key_id) ? body.key_id : null;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await isActiveDevice(admin, userId, deviceId))) {
    return json(409, { code: 'DEVICE_INACTIVE', message: 'This device is not active.' });
  }

  if (body.action === 'challenge') {
    let binding;
    try { binding = challengeContext(body); } catch (error) {
      return json(400, { code: 'VALIDATION_FAILED', message: error instanceof Error ? error.message : 'Invalid request.' });
    }

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from('app_attest_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .gte('created_at', since);
    if (countError) return json(500, { code: 'STORAGE_ERROR', message: 'Device verification is temporarily unavailable.' });
    if ((count ?? 0) >= 30) return json(429, { code: 'RATE_LIMITED', message: 'Too many verification attempts. Try again later.' });

    const challenge = randomChallenge();
    const challengeHash = await sha256Hex(challenge);
    const configuredTtl = Number(Deno.env.get('APP_ATTEST_CHALLENGE_TTL_SECONDS') ?? '300');
    const ttlSeconds = Number.isFinite(configuredTtl) ? Math.min(600, Math.max(60, configuredTtl)) : 300;
    const { error: insertError } = await admin.from('app_attest_challenges').insert({
      challenge_hash: challengeHash,
      user_id: userId,
      device_id: deviceId,
      key_id: keyId,
      purpose: binding.purpose,
      context: binding.context,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
    if (insertError) {
      console.error('[app-attest-enroll] challenge insert failed', { code: insertError.code });
      return json(500, { code: 'STORAGE_ERROR', message: 'Device verification is temporarily unavailable.' });
    }
    void admin.rpc('prune_app_attest_challenges');
    return json(200, { challenge, expires_in: ttlSeconds });
  }

  // A failed attestKeyAsync/generateAssertionAsync never reaches the server on
  // its own: the call fails device-to-Apple, and the client is left holding the
  // only copy of the reason. Recording the code here is what keeps an incident
  // attributable after the fact. Authentication, device validation and key
  // format are already enforced above, so this only has to store the report.
  if (body.action === 'report_failure') {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('app_attest_failures')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .gte('created_at', since);

    // Dropped silently past the cap. Diagnostics must never become a way to
    // fill the table, and must never hand the caller a second failure to deal
    // with on top of the one it is reporting.
    if ((count ?? 0) < 30) {
      const { error: reportError } = await admin.from('app_attest_failures').insert({
        user_id: userId,
        device_id: deviceId,
        key_id: keyId,
        stage: body.stage === 'assert' ? 'assert' : 'attest',
        error_code: stringOrNull(body.error_code, 128),
        error_message: stringOrNull(body.error_message, 500),
        platform: body.platform === 'android' ? 'android' : 'ios',
        app_version: stringOrNull(body.app_version, 64),
      });
      if (reportError) {
        console.error('[app-attest-enroll] failure report insert failed', { code: reportError.code });
      }
    }
    void admin.rpc('prune_app_attest_failures');
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (body.action !== 'attest' || typeof body.challenge !== 'string' || typeof body.attestation !== 'string') {
    return json(400, { code: 'VALIDATION_FAILED', message: 'Device attestation request is invalid.' });
  }

  const challengeHash = await sha256Hex(body.challenge);
  const { data: claimed, error: claimError } = await admin.rpc('claim_app_attest_challenge', {
    p_challenge_hash: challengeHash,
    p_user_id: userId,
    p_device_id: deviceId,
    p_key_id: keyId,
    p_purpose: 'enroll',
    p_context: {},
  });
  if (claimError) {
    console.error('[app-attest-enroll] challenge claim failed', { code: claimError.code });
    return json(500, { code: 'STORAGE_ERROR', message: 'Device verification is temporarily unavailable.' });
  }
  if (claimed !== true) return json(401, { code: 'ATTESTATION_REJECTED', message: 'Device challenge expired or was already used.' });

  let verified;
  try {
    const { verifyAppleAttestation } = await import('../_shared/app-attest.ts');
    verified = await verifyAppleAttestation({ attestation: body.attestation, challenge: body.challenge, keyId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.warn('[app-attest-enroll] attestation rejected', { message: reason });
    const detail = Deno.env.get('APP_ATTEST_ENVIRONMENT') === 'development' ? ` (${reason})` : '';
    return json(401, { code: 'ATTESTATION_REJECTED', message: `This app installation could not be verified.${detail}` });
  }

  const { data: existing, error: existingError } = await admin
    .from('app_attest_keys')
    .select('user_id,device_id')
    .eq('key_id', keyId)
    .maybeSingle();
  if (existingError) return json(500, { code: 'STORAGE_ERROR', message: 'Device verification is temporarily unavailable.' });
  if (existing && (existing.user_id !== userId || existing.device_id !== deviceId)) {
    return json(409, { code: 'ATTESTATION_REJECTED', message: 'This device key is already registered.' });
  }

  const { error: deactivateError } = await admin
    .from('app_attest_keys')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .neq('key_id', keyId);
  if (deactivateError) return json(500, { code: 'STORAGE_ERROR', message: 'Device verification is temporarily unavailable.' });

  const { error: keyError } = await admin.from('app_attest_keys').upsert({
    key_id: keyId,
    user_id: userId,
    device_id: deviceId,
    public_key_pem: verified.publicKeyPem,
    receipt_base64: verified.receiptBase64,
    environment: verified.environment,
    validation_category: verified.validationCategory,
    bundle_version: verified.bundleVersion,
    extensions_present: verified.extensionsPresent,
    sign_count: 0,
    active: true,
    attested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key_id' });
  if (keyError) {
    console.error('[app-attest-enroll] key store failed', { code: keyError.code });
    return json(500, { code: 'STORAGE_ERROR', message: 'Device verification is temporarily unavailable.' });
  }

  return json(200, { accepted: true });
});
