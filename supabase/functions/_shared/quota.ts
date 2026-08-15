// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Server-side quota: one call to public.can_scan(), which decides and debits
 * inside a single transaction under a row lock on the user.
 *
 * The arithmetic moved into SQL because it has to run in the same transaction
 * as the debit — evaluating here and charging later left a window where two
 * parallel captures could both spend the last scan, and left nothing bounding
 * how fast a user could call a paid model. The rule in contracts/quota.ts
 * remains the client's advisory copy for the shutter gate; the B4 gate pins the
 * cap and the product ids in both places so they cannot drift.
 *
 * This is the only authority.
 */
import { PRO_MONTHLY_CAP, type QuotaVerdict } from './contracts/quota.ts';
import { MAX_FAIR_USE_THRESHOLD, tierForProduct, type Tier } from './contracts/products.ts';

export { MAX_FAIR_USE_THRESHOLD, PRO_MONTHLY_CAP, tierForProduct };
export type { QuotaVerdict, Tier };

/** Just the slice of a supabase-js client this needs, so callers can pass either. */
type RpcClient = { rpc: (name: string, params: Record<string, unknown>) => any };

/** Adds the burst verdict to the shared reasons; the client never sees it as a paywall. */
export type ScanVerdict = QuotaVerdict & { reason: QuotaVerdict['reason'] | 'rate_limited' };

/**
 * Decide and charge. `remaining` already accounts for this scan. Anything that
 * turns out not to be billable must call refundScan() with the same capture id.
 */
export async function evaluateQuota(client: RpcClient, userId: string, captureId: string): Promise<ScanVerdict> {
  const { data, error } = await client.rpc('can_scan', { p_user_id: userId, p_capture_id: captureId });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('can_scan returned no verdict');

  // out_ prefixed so nothing the function returns can shadow a column name
  // inside its own body — the first cut named them `reason`/`allowed` and every
  // scan failed on the ambiguity.
  return {
    canScan: row.out_allowed === true,
    reason: row.out_reason,
    remaining: row.out_remaining == null ? null : Number(row.out_remaining),
    // The paywall hint names the tier being SOLD, not the tier held: a
    // free user is sold Pro, a capped Pro user is sold Max (D8).
    paywall: row.out_paywall === 'max' ? 'max' : 'pro',
    deprioritized: row.out_deprioritized === true,
  };
}

/** Give back a scan charged at decision time that turned out not to be billable. */
export async function refundScan(client: RpcClient, userId: string, captureId: string): Promise<void> {
  const { error } = await client.rpc('refund_scan', { p_user_id: userId, p_capture_id: captureId });
  if (error) throw error;
}
