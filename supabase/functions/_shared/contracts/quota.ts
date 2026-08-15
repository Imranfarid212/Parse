/**
 * The can_scan() rule (Blueprint D16/§8.3), as a pure function.
 *
 * Both the server (functions/_shared/quota.ts) and the client (the shutter gate)
 * decide with THIS code. Only the data-fetching differs. The server remains the
 * only authority — the client's copy exists to answer instantly and offline —
 * but neither may invent its own arithmetic.
 *
 * The rule keys off the TIER a product grants, never off a product id: four
 * store products (month/year x default/promo) grant `pro`, four grant `max`, and
 * the allowance is identical across the four in each set. See products.ts.
 *
 * Keep this file dependency-free: it is imported from Deno, where extensionless
 * relative imports do not resolve.
 */
import {
  MAX_FAIR_USE_THRESHOLD,
  MONTHLY_SCAN_CAP,
  tierForProduct,
  type Tier,
} from './products.ts';

export const PRO_MONTHLY_CAP = MONTHLY_SCAN_CAP.pro as number;

/** Raw counts, however they were obtained. */
export type QuotaSnapshot = {
  /** product_id of an active|grace subscription, else null. */
  productId: string | null;
  /** current_period_start of that subscription, else null. */
  periodStart: string | null;
  /** scan_used rows since periodStart. Meaningful for any paid tier. */
  usedThisPeriod: number | null;
  /** SUM(scan_ledger.delta) — the free-tier balance. */
  freeBalance: number | null;
};

export type QuotaReason =
  | 'max_unlimited'
  | 'pro_within_cap'
  | 'pro_cap_hit'
  | 'free_balance'
  | 'free_exhausted';

export type QuotaVerdict = {
  canScan: boolean;
  /** Which paywall a 402 routes to (D8): a capped Pro user is sold Max. */
  paywall: Tier;
  /** Scans left before the next block. null means uncapped. */
  remaining: number | null;
  reason: QuotaReason;
  /**
   * True when an uncapped user is past the fair-use threshold. The scan still
   * runs — this is not a refusal — but it may be queued behind everyone else.
   * Nothing in the UI calls this "blocked", because it is not.
   */
  deprioritized: boolean;
};

export function decideQuota(snapshot: QuotaSnapshot): QuotaVerdict {
  const tier = tierForProduct(snapshot.productId);

  if (tier === 'max') {
    const used = Math.max(0, snapshot.usedThisPeriod ?? 0);
    return {
      canScan: true,
      paywall: 'max',
      remaining: null,
      reason: 'max_unlimited',
      deprioritized: used >= MAX_FAIR_USE_THRESHOLD,
    };
  }

  if (tier && snapshot.periodStart) {
    const cap = MONTHLY_SCAN_CAP[tier];
    // A tier with no cap was handled above; this is belt-and-braces so a future
    // uncapped tier cannot silently fall through to `Math.max(0, null - used)`.
    if (cap == null) {
      return { canScan: true, paywall: tier, remaining: null, reason: 'max_unlimited', deprioritized: false };
    }
    const used = Math.max(0, snapshot.usedThisPeriod ?? 0);
    const remaining = Math.max(0, cap - used);
    return remaining > 0
      ? { canScan: true, paywall: 'max', remaining, reason: 'pro_within_cap', deprioritized: false }
      : { canScan: false, paywall: 'max', remaining: 0, reason: 'pro_cap_hit', deprioritized: false };
  }

  const balance = snapshot.freeBalance ?? 0;
  return balance > 0
    ? { canScan: true, paywall: 'pro', remaining: balance, reason: 'free_balance', deprioritized: false }
    : { canScan: false, paywall: 'pro', remaining: 0, reason: 'free_exhausted', deprioritized: false };
}
