// @ts-nocheck - Supabase Edge Functions run under Deno, outside Expo's tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { isDeviceId } from '../_shared/device.ts';
import { secureBearerMatches, sha256Hex } from '../_shared/app-attest-utils.ts';
import { normalizeReferralCode } from '../_shared/referrals.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const invalid = (verdict: string, riskSignals: Record<string, unknown> = {}) =>
  json(200, { valid: false, verdict, risk_signals: riskSignals });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { message: 'POST required' });
  const internalSecret = Deno.env.get('APP_INTEGRITY_VERIFIER_AUTH') ?? '';
  if (!(await secureBearerMatches(req.headers.get('Authorization'), internalSecret))) return json(401, { message: 'Unauthorized' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(500, { message: 'Verifier storage is not configured.' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { message: 'A JSON body is required.' }); }
  const proof = body.proof as Record<string, unknown> | null;
  const context = body.context as Record<string, unknown> | null;
  if ((body.action !== 'referral_redeem' && body.action !== 'signup_integrity') || !proof || !context) {
    return json(400, { message: 'Invalid verifier request.' });
  }
  const userId = typeof context.user_id === 'string' ? context.user_id : '';
  const deviceId = typeof context.device_id === 'string' ? context.device_id : '';
  if (!userId || !isDeviceId(deviceId)) return invalid('malformed_proof');

  if (proof.platform === 'android') {
    const token = typeof proof.token === 'string' ? proof.token : '';
    let requestContext: string;
    if (body.action === 'signup_integrity') {
      requestContext = `signup_integrity:${userId}:${deviceId}`;
    } else {
      const code = normalizeReferralCode(context.code);
      const entryMethod = context.entry_method;
      if (!code || (entryMethod !== 'code' && entryMethod !== 'link')) return invalid('malformed_proof');
      requestContext = `referral_redeem:${userId}:${deviceId}:${code}:${entryMethod}`;
    }
    try {
      const { playIntegrityRequestHash, verifyPlayIntegrity } = await import('../_shared/play-integrity.ts');
      const result = await verifyPlayIntegrity(token, await playIntegrityRequestHash(requestContext));
      return json(200, { valid: result.valid, verdict: result.verdict, risk_signals: result.riskSignals });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      console.error('[app-integrity-verify] Play Integrity verification unavailable', { message: reason });
      return json(503, { message: 'Play Integrity verification is unavailable.' });
    }
  }

  if (proof.platform !== 'ios') return invalid('platform_not_supported', { platform: proof.platform ?? 'unknown' });
  if (body.action !== 'referral_redeem') return invalid('platform_action_not_supported', { platform: 'ios' });

  const code = normalizeReferralCode(context.code);
  const entryMethod = context.entry_method;
  const keyId = typeof proof.key_id === 'string' ? proof.key_id : '';
  const challenge = typeof proof.challenge === 'string' ? proof.challenge : '';
  const assertion = typeof proof.token === 'string' ? proof.token : '';
  if (!code || (entryMethod !== 'code' && entryMethod !== 'link') || !keyId || !challenge || !assertion) {
    return invalid('malformed_proof');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: key, error: keyError } = await admin
    .from('app_attest_keys')
    .select('public_key_pem,sign_count,environment,validation_category,bundle_version,extensions_present')
    .eq('key_id', keyId)
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .eq('active', true)
    .maybeSingle();
  if (keyError) {
    console.error('[app-integrity-verify] key lookup failed', { code: keyError.code });
    return json(500, { message: 'Verifier storage is unavailable.' });
  }
  if (!key) return invalid('app_attest_key_unknown');

  const challengeHash = await sha256Hex(challenge);
  const { data: claimed, error: claimError } = await admin.rpc('claim_app_attest_challenge', {
    p_challenge_hash: challengeHash,
    p_user_id: userId,
    p_device_id: deviceId,
    p_key_id: keyId,
    p_purpose: 'referral_redeem',
    p_context: { code, entry_method: entryMethod },
  });
  if (claimError) {
    console.error('[app-integrity-verify] challenge claim failed', { code: claimError.code });
    return json(500, { message: 'Verifier storage is unavailable.' });
  }
  if (claimed !== true) return invalid('app_attest_challenge_rejected', { replay_or_expired: true });

  let verified;
  try {
    const { verifyAppleAssertion } = await import('../_shared/app-attest.ts');
    verified = await verifyAppleAssertion({
      assertion,
      challenge,
      publicKeyPem: key.public_key_pem,
      signCount: Number(key.sign_count),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.warn('[app-integrity-verify] assertion rejected', { message: reason });
    return invalid('app_attest_assertion_rejected', Deno.env.get('APP_ATTEST_ENVIRONMENT') === 'development'
      ? { development_reason: reason }
      : {});
  }
  if (verified.extensionsPresent !== key.extensions_present
    || (verified.extensionsPresent && (verified.validationCategory !== key.validation_category
      || verified.bundleVersion !== key.bundle_version))) {
    return invalid('app_attest_build_changed', { build_binding_changed: true });
  }

  const { data: advanced, error: counterError } = await admin.rpc('advance_app_attest_counter', {
    p_key_id: keyId,
    p_user_id: userId,
    p_device_id: deviceId,
    p_expected_count: Number(key.sign_count),
    p_next_count: verified.signCount,
  });
  if (counterError) {
    console.error('[app-integrity-verify] counter update failed', { code: counterError.code });
    return json(500, { message: 'Verifier storage is unavailable.' });
  }
  if (advanced !== true) return invalid('app_attest_counter_replay', { counter_replay: true });

  return json(200, {
    valid: true,
    verdict: key.environment === 'production' ? 'app_attest_production' : 'app_attest_development',
    risk_signals: {
      validation_category: verified.validationCategory,
      bundle_version: verified.bundleVersion,
      extensions_present: verified.extensionsPresent,
    },
  });
});
