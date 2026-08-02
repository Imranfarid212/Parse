/**
 * Client-side scan balance — the shutter gate.
 *
 * This is UX only. The server re-checks every scan and is the sole authority
 * (functions/_shared/quota.ts); this exists so an out-of-scans user is told
 * instantly, at the tap, instead of after a photo, an upload and a model call.
 *
 * The arithmetic is NOT duplicated here: both sides call `decideQuota` from
 * contracts. Only the data-fetching differs.
 */
import {
  decideQuota,
  PRODUCT_PLUS,
  PRODUCT_UNLIMITED,
  type QuotaVerdict,
} from '@/../packages/contracts/src/quota';
import { supabase } from '@/lib/auth/supabase';
import * as store from '@/lib/receipts/store';

/** Past this, refresh in the background; the cached answer is still used meanwhile. */
const STALE_AFTER_MS = 5 * 60 * 1000;


export type QuotaGate = {
  canScan: boolean;
  paywall: 'plus' | 'unlimited';
  remaining: number | null;
  /** True when we have never successfully synced — the optimistic allowance. */
  unknown: boolean;
};

let refreshInFlight: Promise<QuotaVerdict | null> | null = null;

/** Reads the counts under RLS and applies the shared rule. */
async function fetchVerdict(userId: string): Promise<QuotaVerdict> {
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('product_id, status, current_period_start')
    .eq('user_id', userId)
    .in('status', ['active', 'grace'])
    .order('current_period_start', { ascending: false })
    .limit(1);
  if (subscriptionError) throw subscriptionError;

  const subscription = subscriptions?.[0] ?? null;
  const productId = subscription?.product_id ?? null;

  if (productId === PRODUCT_UNLIMITED) {
    return decideQuota({ productId, periodStart: null, usedThisPeriod: null, freeBalance: null });
  }

  const periodStart = productId === PRODUCT_PLUS ? subscription?.current_period_start ?? null : null;
  if (periodStart) {
    const { count, error } = await supabase
      .from('scan_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('reason', 'scan_used')
      .gte('created_at', periodStart);
    if (error) throw error;
    return decideQuota({ productId, periodStart, usedThisPeriod: count ?? 0, freeBalance: null });
  }

  const { data: ledger, error } = await supabase.from('scan_ledger').select('delta').eq('user_id', userId);
  if (error) throw error;
  const freeBalance = (ledger ?? []).reduce((sum, row) => sum + (Number(row.delta) || 0), 0);
  return decideQuota({ productId, periodStart: null, usedThisPeriod: null, freeBalance });
}

/** Pulls a fresh verdict and caches it. Resolves null when offline/unreachable. */
export async function refreshQuota(userId: string): Promise<QuotaVerdict | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = fetchVerdict(userId)
    .then(async (verdict) => {
      await store.setCachedQuota(userId, { remaining: verdict.remaining, paywall: verdict.paywall });
      return verdict;
    })
    .catch((error) => {
      if (__DEV__) console.warn('[quota] refresh failed', error instanceof Error ? error.message : String(error));
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * The shutter gate. Answers from cache so it never blocks the tap; refreshes in
 * the background when stale.
 *
 * With no cached value at all — fresh install, cleared data — it allows the
 * scan. Blocking there would tell someone with a bad connection they are out of
 * scans when they are not, and the server still refuses if they really are.
 */
export async function checkQuotaGate(userId: string | null | undefined): Promise<QuotaGate> {
  if (!userId) return { canScan: true, paywall: 'plus', remaining: null, unknown: true };

  const cached = await store.getCachedQuota(userId);
  if (!cached) {
    if (__DEV__) console.warn('[quota] no cached balance — allowing optimistically');
    void refreshQuota(userId);
    return { canScan: true, paywall: 'plus', remaining: null, unknown: true };
  }

  if (Date.now() - cached.fetchedAt > STALE_AFTER_MS) void refreshQuota(userId);

  return {
    canScan: cached.remaining == null || cached.remaining > 0,
    paywall: cached.paywall,
    remaining: cached.remaining,
    unknown: false,
  };
}

/**
 * Apply the server's own count when a scan comes back — free refresh off a call
 * we already made. Falls back to an optimistic decrement when the server did not
 * report one (older function build, or an unlimited plan).
 */
export async function applyServerQuota(
  userId: string | null | undefined,
  scansRemaining: number | null | undefined,
): Promise<void> {
  if (!userId) return;
  if (typeof scansRemaining === 'number') {
    const cached = await store.getCachedQuota(userId);
    await store.setCachedQuota(userId, { remaining: scansRemaining, paywall: cached?.paywall ?? 'plus' });
    return;
  }
  await store.decrementCachedQuota(userId);
}
