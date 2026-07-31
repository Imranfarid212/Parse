// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Server-side can_scan(): reads the counts, then defers to the shared rule in
 * contracts so the client's shutter gate and this cannot drift apart.
 *
 * This is the only authority. The client's copy is advisory UX.
 */
import {
  decideQuota,
  PRODUCT_PLUS,
  PRODUCT_UNLIMITED,
  type QuotaVerdict,
} from './contracts/quota.ts';

export { PRODUCT_PLUS, PRODUCT_UNLIMITED };
export type { QuotaVerdict };

/** Just the slice of a supabase-js client this needs, so callers can pass either. */
type QueryClient = { from: (table: string) => any };

export async function evaluateQuota(client: QueryClient, userId: string): Promise<QuotaVerdict> {
  const { data: subscriptions, error: subscriptionError } = await client
    .from('subscriptions')
    .select('product_id, status, current_period_start')
    .eq('user_id', userId)
    // Grace counts as active for quota — expiry flips on the webhook, not a clock.
    .in('status', ['active', 'grace'])
    .order('current_period_start', { ascending: false })
    .limit(1);
  if (subscriptionError) throw subscriptionError;

  const subscription = subscriptions?.[0] ?? null;
  const productId = subscription?.product_id ?? null;

  if (productId === PRODUCT_UNLIMITED) {
    return decideQuota({ productId, periodStart: null, usedThisPeriod: null, freeBalance: null });
  }

  // current_period_start is authoritative for the monthly window, not created_at.
  const periodStart = productId === PRODUCT_PLUS ? subscription?.current_period_start ?? null : null;
  if (periodStart) {
    const { count, error } = await client
      .from('scan_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('reason', 'scan_used')
      .gte('created_at', periodStart);
    if (error) throw error;
    return decideQuota({ productId, periodStart, usedThisPeriod: count ?? 0, freeBalance: null });
  }

  const { data: ledger, error } = await client.from('scan_ledger').select('delta').eq('user_id', userId);
  if (error) throw error;
  const freeBalance = (ledger ?? []).reduce((sum: number, row: { delta: unknown }) => sum + (Number(row.delta) || 0), 0);
  return decideQuota({ productId, periodStart: null, usedThisPeriod: null, freeBalance });
}
