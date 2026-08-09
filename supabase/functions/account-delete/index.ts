// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * account-delete — the user leaving, for real (D17/§13.2).
 *
 * Order matters, and it is the opposite of the obvious one. The external calls
 * (Apple revocation, RevenueCat unlink) run BEFORE the database transaction,
 * because they are the steps that can fail in ways we cannot undo. If they ran
 * after, a failure would leave the account deleted locally while Apple still
 * held a live token and RevenueCat still held a live subscriber — invisible,
 * unfixable, and a store-review failure.
 *
 * Running them first means a failure leaves the account fully intact and the
 * user can retry. The only cost is that a retry re-runs them, which both are
 * safe against: revoking an already-revoked token and unlinking an
 * already-unlinked subscriber are both no-ops.
 *
 * The database work is one RPC and therefore one transaction. The auth user is
 * deleted last, which revokes every session (Blueprint §13.2) and is also what
 * makes the whole thing irreversible — so nothing precedes it that could still
 * fail.
 *
 * What this function deliberately does NOT do is cancel billing. It cannot: only
 * the store can, and the interstitial the client shows first says so in plain
 * words. Silently letting someone believe deletion stopped their subscription is
 * how a support queue fills with chargebacks.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { readAppleConfig, revokeRefreshToken } from '../_shared/apple.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Deletes the RevenueCat subscriber so a deleted account stops receiving
 * webhooks and its purchases are no longer attributed to a live user.
 *
 * Returns false rather than throwing when RevenueCat is not configured or does
 * not know this user: neither is a reason to refuse a deletion. A 404 means the
 * subscriber never existed — a user who never opened the paywall — which is the
 * desired end state already.
 */
async function unlinkRevenueCat(userId: string): Promise<boolean> {
  const secretKey = Deno.env.get('RC_SECRET_API_KEY');
  if (!secretKey) {
    console.log('[account-delete] RevenueCat not configured; skipping unlink');
    return false;
  }

  try {
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (response.ok || response.status === 404) return response.ok;
    console.warn('[account-delete] RevenueCat unlink refused', { status: response.status });
    return false;
  } catch (error) {
    console.warn('[account-delete] RevenueCat unlink failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST only' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json(500, { status: 500, code: 'DELETE_FAILED', message: 'server not configured' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { status: 401, code: 'UNAUTHORIZED' });

  // The JWT is the only thing that names the account. There is no request body
  // at all: an endpoint that accepts "which user to delete" is one bug away from
  // deleting anyone.
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return json(401, { status: 401, code: 'UNAUTHORIZED' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const retentionYears = Number(Deno.env.get('RETENTION_FINANCIAL_YEARS') ?? '5');

  try {
    // --- 1. Apple token revocation -----------------------------------------
    // Taking the token deletes it in the same statement, so it cannot outlive
    // the account even if the call below fails.
    let appleRevoked = false;
    const appleConfig = readAppleConfig();
    if (appleConfig) {
      const { data: token, error: tokenError } = await admin.rpc('take_apple_refresh_token', {
        p_user_id: userId,
      });
      if (tokenError) throw tokenError;
      if (typeof token === 'string' && token.length > 0) {
        appleRevoked = await revokeRefreshToken(appleConfig, token);
      }
    }

    // --- 2. RevenueCat unlink ----------------------------------------------
    const revenueCatUnlinked = await unlinkRevenueCat(userId);

    // --- 3. One transaction: tombstone, purge, anonymise -------------------
    const { data, error } = await admin.rpc('delete_account', {
      p_user_id: userId,
      p_retention_years: Number.isFinite(retentionYears) ? retentionYears : 5,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;

    // --- 4. The auth user, which revokes every session ---------------------
    // Last, because it is the one step with nothing after it to roll back. If
    // it fails the user rows are already gone, so it is retried once rather
    // than leaving a signed-in shell of a deleted account.
    let authDeleted = true;
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      const retry = await admin.auth.admin.deleteUser(userId);
      authDeleted = !retry.error;
      if (retry.error) {
        console.error('[account-delete] auth user survived deletion', {
          user_id: userId,
          message: retry.error.message,
        });
      }
    }

    console.log('[account-delete] completed', {
      user_id: userId,
      apple_revoked: appleRevoked,
      revenuecat_unlinked: revenueCatUnlinked,
      auth_deleted: authDeleted,
      receipts_deleted: result?.out_receipts_deleted ?? 0,
      images_queued: result?.out_images_queued ?? 0,
      exports_queued: result?.out_exports_queued ?? 0,
      payment_events_anonymized: result?.out_payment_events_anonymized ?? 0,
    });

    return json(200, {
      status: 200,
      deleted: true,
      apple_revoked: appleRevoked,
      revenuecat_unlinked: revenueCatUnlinked,
      purge_financial_at: result?.out_purge_financial_at ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The RPC is one transaction, so a failure inside it left nothing behind.
    // The client's copy says exactly that: nothing was removed, try again.
    console.error('[account-delete] failed', { user_id: userId, message });
    return json(500, { status: 500, code: 'DELETE_FAILED', message });
  }
});
