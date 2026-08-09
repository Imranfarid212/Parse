/**
 * The product catalogue — the single source of truth for what Parse sells.
 *
 * Read this file before touching anything billing-related. Three ideas:
 *
 *   tier        what the user gets (pro / max). Quota keys off this, never off
 *               a product id, because four products grant two tiers.
 *   term        how often they pay (month / year). Never affects entitlement.
 *   offering    which price list they were shown (default / promo). A RevenueCat
 *               offering is a real set of store products, so a promo price is a
 *               product Apple and Google actually charge — not a client-side
 *               discount, which would show a price the store does not honour.
 *
 * Product ids encode tier + term + offering and NOTHING else. They deliberately
 * do not carry the price: store product ids are permanent, so `parse_pro_699_m`
 * becomes a lie the first time the price moves, and the id can never be fixed.
 *
 * These ids are not secrets — they ship in the app binary and on the store
 * listing. What IS secret (RevenueCat keys, the webhook auth token) lives in
 * env and is never imported from here.
 *
 * Keep this file dependency-free: it is imported from Deno, where extensionless
 * relative imports do not resolve.
 */

/** What the user gets. Entitlements are granted per tier. */
export const tiers = ['pro', 'max'] as const;
export type Tier = (typeof tiers)[number];

/** How often they pay. Never affects what they get. */
export const terms = ['month', 'year'] as const;
export type Term = (typeof terms)[number];

/**
 * Which price list the user was shown.
 *
 * `promo` exists because the Plan screen's "Early promotion discount" switch has
 * to correspond to something real. Today the client decides which offering to
 * show; the shape is built so that decision can move server-side later (an
 * eligibility flag on the profile picking the offering) without the store
 * products, the entitlements or this file changing at all.
 */
export const offerings = ['default', 'promo'] as const;
export type Offering = (typeof offerings)[number];

/**
 * RevenueCat entitlement identifiers. Configure these in the RevenueCat
 * dashboard exactly as spelled here; every product of a tier grants its tier's
 * entitlement, whatever the term or offering.
 */
export const ENTITLEMENT_PRO = 'pro';
export const ENTITLEMENT_MAX = 'max';

export const entitlementForTier: Record<Tier, string> = {
  pro: ENTITLEMENT_PRO,
  max: ENTITLEMENT_MAX,
};

/**
 * Monthly scan allowance per tier.
 *
 * `null` means uncapped. The Plan screen sells Pro as "200 uploads per month",
 * so 200 is what the server enforces — the number is defined once, here, and
 * the products table mirrors it into SQL so can_scan() never carries its own
 * copy of the arithmetic.
 */
export const MONTHLY_SCAN_CAP: Record<Tier, number | null> = {
  pro: 200,
  max: null,
};

/**
 * Fair-use threshold on the uncapped tier (Blueprint D8: no 'unlimited' claim is
 * broken, but traffic past this point is deprioritised rather than refused).
 * Scans are still allowed above it; they are marked so the queue can order them
 * behind everyone else.
 */
export const MAX_FAIR_USE_THRESHOLD = 2000;

export type ProductDefinition = {
  id: string;
  tier: Tier;
  term: Term;
  offering: Offering;
};

/** Builds the canonical id. Exported so tests and the store runbook agree. */
export function productId(tier: Tier, term: Term, offering: Offering): string {
  const suffix = term === 'month' ? 'm' : 'y';
  return offering === 'promo' ? `parse_${tier}_${suffix}_promo` : `parse_${tier}_${suffix}`;
}

/** All eight store products, generated so the list cannot drift from the rule. */
export const PRODUCTS: ProductDefinition[] = offerings.flatMap((offering) =>
  tiers.flatMap((tier) =>
    terms.map((term) => ({ id: productId(tier, term, offering), tier, term, offering })),
  ),
);

const BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]));

/** Resolves a store product id to its definition, or null if unknown. */
export function findProduct(id: string | null | undefined): ProductDefinition | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/**
 * The tier a product grants. Unknown ids resolve to null rather than throwing:
 * a store can deliver a product this build has never heard of (a new SKU, a
 * rolled-back release), and the safe reading of "unrecognised" is "no tier",
 * which falls through to the free-tier rules rather than granting anything.
 */
export function tierForProduct(id: string | null | undefined): Tier | null {
  return findProduct(id)?.tier ?? null;
}

/** Every product in one offering, in the order the Plan screen lists them. */
export function productsForOffering(offering: Offering): ProductDefinition[] {
  return PRODUCTS.filter((product) => product.offering === offering);
}
