/**
 * The Plan screen's data: both price lists, resolved into the shape the UI
 * already thinks in (tier x term x offering).
 *
 * Kept out of the screen so the screen stays a rendering of props, and so the
 * package-lookup rule — which is where a wrong SKU silently becomes a missing
 * price — is testable on its own.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  productId,
  type Offering,
  type Term,
  type Tier,
} from '@/../packages/contracts/src/products';
import { fetchOfferings, type PurchasesOffering, type PurchasesPackage } from '@/lib/billing/purchases';
import { previewPriceFor, previewPricingAllowed } from '@/lib/billing/preview-pricing';

export type PriceEntry = {
  /** Formatted by the store in the user's own currency — never composed here. */
  priceString: string;
  /**
   * Null only for a preview entry, which therefore cannot be purchased: the
   * Subscribe button needs a package and there is none. That is the type system
   * carrying the safety property rather than a comment asking for it.
   */
  pkg: PurchasesPackage | null;
};

export type PlanPrices = {
  /** `${offering}:${tier}:${term}` -> price. Missing keys mean "not for sale". */
  entries: Record<string, PriceEntry>;
  loading: boolean;
  /** True when the store returned no offerings at all (unconfigured, or offline). */
  empty: boolean;
  /** True when a promo price list exists and the promo switch should be shown. */
  hasPromo: boolean;
  /**
   * True when the prices shown are the design's reference values because the
   * store was unreachable. Never true in production, and never true when the
   * store answered. The screen must label it.
   */
  preview: boolean;
  reload: () => void;
};

export const priceKey = (offering: Offering, tier: Tier, term: Term) => `${offering}:${tier}:${term}`;

/**
 * Finds the package for one product within an offering.
 *
 * Matched on the store product identifier rather than on RevenueCat's package
 * type (MONTHLY/ANNUAL), because package type cannot distinguish Pro-monthly
 * from Max-monthly — both are MONTHLY — and picking the first match would sell
 * the wrong tier at the right price.
 *
 * Android product identifiers can carry a `:basePlanId` suffix, so the
 * comparison is on the part before the colon, exactly as the webhook normalises
 * it server-side.
 */
export function findPackage(
  offering: PurchasesOffering | null,
  wanted: string,
): PurchasesPackage | null {
  if (!offering) return null;
  const packages = offering.availablePackages ?? [];
  return (
    packages.find((pkg) => {
      const identifier = pkg?.product?.identifier ?? '';
      return identifier.split(':')[0] === wanted;
    }) ?? null
  );
}

const TIERS: Tier[] = ['pro', 'max'];
const TERMS: Term[] = ['month', 'year'];
const OFFERINGS: Offering[] = ['default', 'promo'];

export function usePlanOfferings(): PlanPrices {
  const [offerings, setOfferings] = useState<Record<Offering, PurchasesOffering | null> | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchOfferings().then((result) => {
      if (cancelled) return;
      setOfferings(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return useMemo(() => {
    const entries: Record<string, PriceEntry> = {};
    for (const offering of OFFERINGS) {
      const source = offerings?.[offering] ?? null;
      for (const tier of TIERS) {
        for (const term of TERMS) {
          const pkg = findPackage(source, productId(tier, term, offering));
          // A product configured in the dashboard but rejected by the store
          // arrives with no price. Treating that as absent keeps the screen from
          // rendering an empty price next to a live Subscribe button.
          if (!pkg?.product?.priceString) continue;
          entries[priceKey(offering, tier, term)] = { priceString: pkg.product.priceString, pkg };
        }
      }
    }

    const empty = Object.keys(entries).length === 0;

    // Only when the store gave us nothing at all. A partially-configured store —
    // some products live, others rejected — keeps its real prices and simply
    // shows fewer options, because mixing real and reference prices on one
    // screen is the one outcome worse than showing neither.
    const preview = empty && !loading && previewPricingAllowed;
    if (preview) {
      for (const offering of OFFERINGS) {
        for (const tier of TIERS) {
          for (const term of TERMS) {
            const priceString = previewPriceFor(offering, tier, term);
            if (priceString) entries[priceKey(offering, tier, term)] = { priceString, pkg: null };
          }
        }
      }
    }

    const hasPromo = Object.keys(entries).some((key) => key.startsWith('promo:'));

    return { entries, loading, empty, hasPromo, preview, reload };
  }, [offerings, loading, reload]);
}
