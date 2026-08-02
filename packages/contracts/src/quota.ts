/**
 * The can_scan() rule (Blueprint D16/§8.3), as a pure function.
 *
 * Both the server (functions/_shared/quota.ts) and the client (the shutter gate)
 * decide with THIS code. Only the data-fetching differs. The server remains the
 * only authority — the client's copy exists to answer instantly and offline —
 * but neither may invent its own arithmetic.
 *
 * Keep this file dependency-free: it is imported from Deno, where extensionless
 * relative imports do not resolve.
 */

export const PRODUCT_PLUS = 'rf_plus_699_m';
export const PRODUCT_UNLIMITED = 'rf_unlimited_1199_m';
export const PLUS_MONTHLY_CAP = 500;

/** Raw counts, however they were obtained. */
export type QuotaSnapshot = {
  /** product_id of an active|grace subscription, else null. */
  productId: string | null;
  /** current_period_start for a Plus subscription, else null. */
  periodStart: string | null;
  /** scan_used rows since periodStart. Only meaningful for Plus. */
  usedThisPeriod: number | null;
  /** SUM(scan_ledger.delta) — the free-tier balance. */
  freeBalance: number | null;
};

export type QuotaVerdict = {
  canScan: boolean;
  /** Which paywall a 402 routes to (D8): a capped Plus user is sold Unlimited. */
  paywall: 'plus' | 'unlimited';
  /** Scans left before the next block. null means unlimited. */
  remaining: number | null;
  reason: 'unlimited' | 'plus_within_cap' | 'plus_cap_hit' | 'free_balance' | 'free_exhausted';
};

export function decideQuota(snapshot: QuotaSnapshot): QuotaVerdict {
  if (snapshot.productId === PRODUCT_UNLIMITED) {
    return { canScan: true, paywall: 'unlimited', remaining: null, reason: 'unlimited' };
  }

  if (snapshot.productId === PRODUCT_PLUS && snapshot.periodStart) {
    const used = Math.max(0, snapshot.usedThisPeriod ?? 0);
    const remaining = Math.max(0, PLUS_MONTHLY_CAP - used);
    return remaining > 0
      ? { canScan: true, paywall: 'unlimited', remaining, reason: 'plus_within_cap' }
      : { canScan: false, paywall: 'unlimited', remaining: 0, reason: 'plus_cap_hit' };
  }

  const balance = snapshot.freeBalance ?? 0;
  return balance > 0
    ? { canScan: true, paywall: 'plus', remaining: balance, reason: 'free_balance' }
    : { canScan: false, paywall: 'plus', remaining: 0, reason: 'free_exhausted' };
}
