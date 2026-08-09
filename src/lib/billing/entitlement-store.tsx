/**
 * entitlementStore — what the UI believes the user's plan is.
 *
 * Two sources, deliberately kept apart:
 *
 *   serverTier   from the `subscriptions` row, via the quota gate. This is the
 *                truth. can_scan() decides from the same row.
 *   storeTier    from RevenueCat's customer info. This is what the STORE thinks,
 *                which after a purchase is correct several seconds before the
 *                webhook has landed.
 *
 * The screens read `tier`, which prefers whichever grants more, because the only
 * time they disagree is the gap between a completed purchase and the webhook
 * that records it — and during that gap the user has genuinely paid. Nothing
 * about this affects whether a scan is allowed: the server re-checks every scan
 * and this store has no vote there. It exists so a user who just paid does not
 * keep seeing a paywall.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Tier } from '@/../packages/contracts/src/products';
import { useAuth } from '@/lib/auth/auth-context';
import { billingAvailable } from '@/lib/billing/config';
import {
  forgetUser,
  getCustomerInfo,
  identify,
  restorePurchases,
  tierFromCustomerInfo,
  type PurchaseOutcome,
} from '@/lib/billing/purchases';
import { refreshQuota } from '@/lib/receipts/quota';

type EntitlementState = {
  /** The effective tier, or null for the free tier. */
  tier: Tier | null;
  /** What RevenueCat reports. Diverges from the server only briefly. */
  storeTier: Tier | null;
  /**
   * Scans left before the next block, or null when uncapped/unknown. Advisory
   * only — the server re-checks every scan — but it is what the Plan screen's
   * trial badge counts down.
   */
  remaining: number | null;
  /** True until the first read completes. */
  loading: boolean;
  /** True when this build has no RevenueCat keys. */
  unavailable: boolean;
  refresh: () => Promise<void>;
  restore: () => Promise<PurchaseOutcome>;
};

const EntitlementContext = createContext<EntitlementState | null>(null);

/** Max outranks Pro outranks free, so the more generous of the two sources wins. */
function bestTier(a: Tier | null, b: Tier | null): Tier | null {
  if (a === 'max' || b === 'max') return 'max';
  if (a === 'pro' || b === 'pro') return 'pro';
  return null;
}

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const [storeTier, setStoreTier] = useState<Tier | null>(null);
  const [serverTier, setServerTier] = useState<Tier | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Guards against a slow refresh from a previous user landing after a switch.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!userId) {
      setStoreTier(null);
      setServerTier(null);
      setRemaining(null);
      setLoading(false);
      return;
    }

    // The two reads are independent; running them together halves the time the
    // Plan screen spends on a spinner.
    const [info, verdict] = await Promise.all([getCustomerInfo(), refreshQuota(userId)]);
    if (request !== generation.current) return;

    setStoreTier(tierFromCustomerInfo(info));
    // A null verdict means the refresh failed (offline). The previous value is
    // kept rather than downgrading the user to free on a dropped connection.
    if (verdict) {
      setServerTier(verdict.reason === 'max_unlimited' ? 'max' : verdict.reason.startsWith('pro_') ? 'pro' : null);
      setRemaining(verdict.remaining);
    }
    setLoading(false);
  }, [userId]);

  // Identify to RevenueCat whenever the account changes. Purchases made before
  // sign-in are merged into the account by RevenueCat itself.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (userId) await identify(userId);
      else await forgetUser();
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refresh]);

  // Foreground refresh. A subscription can be bought, cancelled or expire while
  // the app is backgrounded — including from the store's own settings screens,
  // which is exactly where a user goes to cancel.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const restore = useCallback(async () => {
    const outcome = await restorePurchases();
    if (outcome.status === 'purchased') {
      setStoreTier(tierFromCustomerInfo(outcome.customerInfo));
      // A restore can reveal a subscription the server already knows about, so
      // re-read the authority rather than trusting the SDK alone.
      await refresh();
    }
    return outcome;
  }, [refresh]);

  const value = useMemo<EntitlementState>(
    () => ({
      tier: bestTier(serverTier, storeTier),
      storeTier,
      remaining,
      loading,
      unavailable: !billingAvailable,
      refresh,
      restore,
    }),
    [serverTier, storeTier, remaining, loading, refresh, restore],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlements(): EntitlementState {
  const context = useContext(EntitlementContext);
  if (!context) throw new Error('useEntitlements must be used inside EntitlementProvider');
  return context;
}
