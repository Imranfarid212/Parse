// @ts-nocheck - Supabase Edge Functions run under Deno, outside Expo's tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { isActiveDevice, isDeviceId } from '../_shared/device.ts';
import {
  REFERRED_REWARD_SCANS,
  REFERRER_REWARD_SCANS,
  hashIp,
  parseReferralRequest,
  verifyAttestation,
} from '../_shared/referrals.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-rf-device-id',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST required' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ipHashSecret = Deno.env.get('REFERRAL_IP_HASH_SECRET');
  const developmentDiagnostics = Deno.env.get('APP_ATTEST_ENVIRONMENT') === 'development';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !ipHashSecret || ipHashSecret.length < 32) {
    return json(500, { code: 'VALIDATION_FAILED', message: 'Referral service is not configured.' });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json(401, { status: 401, code: 'UNAUTHORIZED' });
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return json(401, { status: 401, code: 'UNAUTHORIZED' });

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { code: 'VALIDATION_FAILED', message: 'A JSON body is required.' }); }
  const parsed = parseReferralRequest(body);
  if ('error' in parsed) return json(400, { status: 400, code: 'VALIDATION_FAILED', message: parsed.error });

  const deviceId = req.headers.get('x-rf-device-id') ?? '';
  if (!isDeviceId(deviceId)) return json(400, { code: 'VALIDATION_FAILED', message: 'Device identity is required.' });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await isActiveDevice(admin, userId, deviceId))) return json(409, { code: 'REFERRAL_BLOCKED', message: 'This device is not active.' });

  let attestation;
  try {
    attestation = await verifyAttestation({
      proof: parsed.request.attestation,
      userId,
      deviceId,
      code: parsed.request.code,
      entryMethod: parsed.request.entryMethod,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[referral-redeem] verifier unavailable', { message: reason });
    return json(503, {
      status: 503,
      code: 'ATTESTATION_UNAVAILABLE',
      message: developmentDiagnostics ? `Referral verification is unavailable. (${reason})` : 'Referral verification is unavailable.',
    });
  }

  const forwarded = req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? `unavailable:${deviceId}`;
  const ipHash = await hashIp(forwarded, ipHashSecret);
  const { data, error } = await admin.rpc('redeem_referral', {
    p_user_id: userId,
    p_code: parsed.request.code,
    p_entry_method: parsed.request.entryMethod,
    p_device_id: deviceId,
    p_ip_hash: ipHash,
    p_attestation_valid: attestation.valid,
    p_attestation_verdict: attestation.verdict,
    p_fraud_flags: attestation.fraudFlags,
  });
  if (error) {
    if (error.code === 'P0002' || error.code === '22023') {
      return json(400, { status: 400, code: 'VALIDATION_FAILED', message: 'That referral code is not valid.' });
    }
    console.error('[referral-redeem] transaction failed', { code: error.code, message: error.message });
    return json(500, {
      code: 'VALIDATION_FAILED',
      message: developmentDiagnostics
        ? `Could not apply the referral. (${error.code ?? 'DB_ERROR'}: ${error.message ?? 'unknown'})`
        : 'Could not apply the referral.',
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const granted = row?.out_granted === true;
  const reason = row?.out_reason ?? (granted ? 'released' : 'blocked');
  if (!attestation.valid && developmentDiagnostics) {
    const developmentReason = typeof attestation.fraudFlags.development_reason === 'string'
      ? attestation.fraudFlags.development_reason
      : attestation.verdict;
    return json(401, {
      status: 401,
      code: 'ATTESTATION_REJECTED',
      message: `Referral proof was rejected. (${developmentReason})`,
    });
  }
  if (reason === 'invalid_code') {
    return json(400, { status: 400, code: 'VALIDATION_FAILED', message: 'That referral code is not valid.' });
  }
  if (reason === 'rate_limited') {
    return json(429, { status: 429, code: 'RATE_LIMITED', message: 'Too many referral attempts. Try again later.' });
  }
  console.log('[referral-redeem] completed', { entry_method: parsed.request.entryMethod, granted, reason });
  return json(200, {
    status: 200,
    granted,
    reason,
    toast: granted ? 'Referral sign up complete, enjoy more free scans' : null,
    rewards: { referrer: REFERRER_REWARD_SCANS, friend: REFERRED_REWARD_SCANS },
  });
});
