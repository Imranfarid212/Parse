// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * apple-link — exchanges Apple's one-time authorization code for a refresh
 * token and stores it, so account-delete can revoke it later.
 *
 * Called by the client immediately after a successful Sign in with Apple. It is
 * best-effort by design: the user is already signed in by the time this runs,
 * and a failure here must not undo that. What it costs is the ability to revoke
 * at deletion time, which is logged and reported back so the client can decide
 * whether to retry — never surfaced as a sign-in error.
 *
 * The code is single-use and expires in about five minutes, so there is no value
 * in queueing it for later.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { exchangeAuthorizationCode, readAppleConfig } from '../_shared/apple.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST only' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json(500, { code: 'VALIDATION_FAILED', message: 'server not configured' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { status: 401, code: 'UNAUTHORIZED' });

  // The JWT names the account. The body never does — letting a caller supply a
  // user id would let anyone attach their own Apple identity to someone else's
  // account.
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return json(401, { status: 401, code: 'UNAUTHORIZED' });

  let body: { authorization_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { status: 400, code: 'VALIDATION_FAILED', message: 'body is not JSON' });
  }

  const authorizationCode = typeof body.authorization_code === 'string' ? body.authorization_code.trim() : '';
  if (!authorizationCode) {
    return json(400, { status: 400, code: 'VALIDATION_FAILED', message: 'authorization_code is required' });
  }

  const config = readAppleConfig();
  if (!config) {
    // An Android-only or local deployment. Not an error — there is simply
    // nothing to link, and saying so plainly beats a 500 the client must guess at.
    console.log('[apple-link] skipped: Apple SIWA is not configured on this deployment');
    return json(200, { status: 200, linked: false, reason: 'not_configured' });
  }

  try {
    const refreshToken = await exchangeAuthorizationCode(config, authorizationCode);
    if (!refreshToken) {
      console.warn('[apple-link] no refresh token returned', { user_id: userId });
      return json(200, { status: 200, linked: false, reason: 'exchange_failed' });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.rpc('store_apple_refresh_token', {
      p_user_id: userId,
      p_refresh_token: refreshToken,
    });
    if (error) throw error;

    // The token itself is never logged, here or anywhere.
    console.log('[apple-link] linked', { user_id: userId });
    return json(200, { status: 200, linked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[apple-link] failed', { user_id: userId, message });
    return json(200, { status: 200, linked: false, reason: 'error' });
  }
});
