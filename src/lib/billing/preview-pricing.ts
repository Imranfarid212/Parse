/**
 * Preview pricing — so the Plan screen can be designed and reviewed before the
 * store accounts exist.
 *
 * Without RevenueCat keys there are no offerings, so every price is unknown and
 * the screen honestly renders "—" against a disabled button. That is correct and
 * it is also unreviewable: nobody can tell whether the layout works, and on
 * staging it just reads as broken.
 *
 * So when the store is unreachable AND this is not a production build, the
 * screen falls back to the reference prices from the design. Three properties
 * make that safe:
 *
 *   1. It is impossible in production. The guard is on EXPO_PUBLIC_ENV, checked
 *      here in one place, and the B8 gate asserts it.
 *   2. It never applies when the store DID answer. Real offerings always win, so
 *      this can never mask or contradict a live price.
 *   3. It is labelled on screen and the Subscribe button stays disabled. A
 *      preview price is never attached to a purchase, so there is no path where
 *      a user is charged something other than what they were shown.
 *
 * These numbers are marketing reference values, not a source of truth. Once the
 * products exist in App Store Connect and Play, the store's own localised
 * strings replace them everywhere and this file stops being reachable.
 */
import type { Offering, Term, Tier } from '@/../packages/contracts/src/products';

/**
 * Production is the one environment where a price the store did not supply must
 * never appear. Anything else — local, staging, preview builds — may show the
 * reference prices so the screen can be worked on.
 */
export const previewPricingAllowed = process.env.EXPO_PUBLIC_ENV !== 'production';

/** `${offering}:${tier}:${term}` -> the design's reference price. */
const PREVIEW_PRICES: Record<string, string> = {
  'default:pro:month': '$9.99',
  'default:pro:year': '$71.99',
  'default:max:month': '$15.99',
  'default:max:year': '$149.99',
  'promo:pro:month': '$6.99',
  'promo:pro:year': '$49.99',
  'promo:max:month': '$10.99',
  'promo:max:year': '$79.99',
};

export function previewPriceFor(offering: Offering, tier: Tier, term: Term): string | null {
  if (!previewPricingAllowed) return null;
  return PREVIEW_PRICES[`${offering}:${tier}:${term}`] ?? null;
}
