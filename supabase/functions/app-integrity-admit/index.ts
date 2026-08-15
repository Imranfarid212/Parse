// @ts-nocheck - Supabase Edge Functions run under Deno, outside Expo's tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { isActiveDevice, isDeviceId } from '../_shared/device.ts';
import { verifySignupAttestation } from '../_shared/referrals.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
  const deviceId = typeof body.device_id === 'string' ? body.device_id : '';
  const proof = body.attestation as Record<string, unknown> | null;
  if (!isDeviceId(deviceId) || proof?.platform !== 'android'
    || typeof proof.token !== 'string' || proof.token.length < 32 || proof.token.length > 16_384) {
    return json(400, { code: 'VALIDATION_FAILED', message: 'Device verification request is invalid.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await isActiveDevice(admin, userId, deviceId))) {
    return json(409, { code: 'DEVICE_INACTIVE', message: 'This device is not active.' });
  }

  let verdict;
  try {
    verdict = await verifySignupAttestation({ proof, userId, deviceId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.error('[app-integrity-admit] verifier unavailable', { message: reason });
    return json(503, { code: 'ATTESTATION_UNAVAILABLE', message: 'Device verification is temporarily unavailable.' });
  }
  if (!verdict.valid) {
    return json(401, { code: 'ATTESTATION_REJECTED', message: 'This app installation could not be verified.' });
  }

  return json(200, { accepted: true, verdict: verdict.verdict });
});
