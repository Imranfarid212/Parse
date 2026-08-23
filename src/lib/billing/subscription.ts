/**
 * Turns RevenueCat's customer info into the one plain object the Billing screen
 * renders.
 *
 * Why this is a mapping layer and not a set of reads at the call site: the
 * screen has to answer "what is this user's billing state" with a SINGLE
 * answer, and the SDK spreads the inputs for that across four places —
 * `entitlements.active`, `subscriptionsByProductIdentifier`, the per-product
 * `PurchasesSubscriptionInfo`, and the top-level `managementURL`. Deriving the
 * state inline meant every branch in the UI re-derived it slightly differently.
 *
 * NOTE — no card data appears anywhere in this file, because none exists.
 * RevenueCat is an entitlement layer over StoreKit and Play Billing; Apple and
 * Google are the merchant of record and neither exposes the payment instrument
 * to a third-party app. There is no PAN, last4, brand or expiry in `CustomerInfo`
 * to surface, masked or otherwise. The screen shows billing STATE and routes to
 * the store for anything that touches the card. That is also what keeps this
 * feature entirely outside PCI DSS scope: the values below are dates, booleans
 * and product identifiers.
 *
 * Type-only import of the SDK type: purchases.ts stays the only module that
 * imports react-native-purchases at runtime.
 */
import { ENTITLEMENT_MAX, ENTITLEMENT_PRO, type Tier } from '@/../packages/contracts/src/products';
import type { CustomerInfo } from '@/lib/billing/purchases';

/**
 * The billing states worth telling a user apart.
 *
 * `cancelled` and `expired` are deliberately distinct: a cancelled subscription
 * is still PAID FOR until its expiry, and telling that user they have no plan
 * is both wrong and the fastest way to a support email. Likewise `grace` vs
 * `billing_issue` — a grace period has a deadline worth showing, and no grace
 * period means access has already stopped.
 */
export type SubscriptionStatus =
  | 'none'
  | 'trial'
  | 'intro'
  | 'active'
  | 'cancelled'
  | 'grace'
  | 'billing_issue'
  | 'paused'
  | 'expired';

/** Which store bills this subscription. `other` covers promos, Amazon, web. */
export type BillingStore = 'app_store' | 'play_store' | 'stripe' | 'promotional' | 'other';

export type SubscriptionSummary = {
  status: SubscriptionStatus;
  tier: Tier | null;
  productIdentifier: string | null;
  /** The dashboard's display name when set; the screen falls back to the tier. */
  displayName: string | null;
  store: BillingStore | null;
  /** End of the current paid period — the renewal date when `willRenew`. */
  expiresAt: string | null;
  willRenew: boolean;
  /** Deadline to fix a payment failure before access stops. */
  gracePeriodExpiresAt: string | null;
  /** Google Play only: when a paused subscription resumes by itself. */
  autoResumeAt: string | null;
  /**
   * Family Sharing. The member did not buy it and CANNOT manage it — showing
   * them a manage button routes to a store screen where their subscription
   * does not appear, which reads as a bug.
   */
  isFamilyShared: boolean;
  /**
   * True when the store billing this subscription is the store on this device.
   * False for the real and common case of subscribing on an iPhone and opening
   * the app on an Android tablet: the manage route has to point at Apple, and
   * `showManageSubscriptions()` on Android cannot do that.
   */
  manageableHere: boolean;
  /** Validated `managementURL`, or null. Never opened unvalidated — see purchases.ts. */
  managementURL: string | null;
  isSandbox: boolean;
};

export const EMPTY_SUMMARY: SubscriptionSummary = {
  status: 'none',
  tier: null,
  productIdentifier: null,
  displayName: null,
  store: null,
  expiresAt: null,
  willRenew: false,
  gracePeriodExpiresAt: null,
  autoResumeAt: null,
  isFamilyShared: false,
  manageableHere: false,
  managementURL: null,
  isSandbox: false,
};

function mapStore(store: string | null | undefined): BillingStore | null {
  switch (store) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'STRIPE':
    case 'RC_BILLING':
      return 'stripe';
    case 'PROMOTIONAL':
      return 'promotional';
    case null:
    case undefined:
      return null;
    default:
      return 'other';
  }
}

/** Human label for the store, used verbatim in the "Billed through" row. */
export function storeLabel(store: BillingStore | null): string {
  switch (store) {
    case 'app_store':
      return 'App Store';
    case 'play_store':
      return 'Google Play';
    case 'stripe':
      return 'Web';
    case 'promotional':
      return 'Complimentary';
    case 'other':
      return 'Another store';
    default:
      return 'Unknown';
  }
}

function tierForProduct(info: CustomerInfo, productIdentifier: string): Tier | null {
  const active = info.entitlements?.active ?? {};
  if (active[ENTITLEMENT_MAX]?.productIdentifier === productIdentifier) return 'max';
  if (active[ENTITLEMENT_PRO]?.productIdentifier === productIdentifier) return 'pro';
  // An expired subscription has no active entitlement to read the tier off, so
  // fall back to the product id, which encodes the tier by construction.
  if (productIdentifier.includes('max')) return 'max';
  if (productIdentifier.includes('pro')) return 'pro';
  return null;
}

/**
 * Picks the subscription the screen is about.
 *
 * A customer can hold several — an upgrade leaves the old one present until it
 * expires, and Family Sharing can add one the user never bought. The active
 * entitlement's product wins, because that is the one currently granting
 * access; failing that, the latest-expiring subscription, so a lapsed user sees
 * their most recent plan rather than an arbitrary one.
 */
function pickProductIdentifier(info: CustomerInfo): string | null {
  const active = info.entitlements?.active ?? {};
  const fromEntitlement =
    active[ENTITLEMENT_MAX]?.productIdentifier ?? active[ENTITLEMENT_PRO]?.productIdentifier ?? null;
  if (fromEntitlement) return fromEntitlement;

  const subs = info.subscriptionsByProductIdentifier ?? {};
  let best: { id: string; expires: number } | null = null;
  for (const [id, sub] of Object.entries(subs)) {
    const expires = sub?.expiresDate ? Date.parse(sub.expiresDate) : 0;
    if (!best || expires > best.expires) best = { id, expires };
  }
  return best?.id ?? null;
}

/**
 * Order matters. A subscription can be several of these at once — a cancelled
 * subscription can also be in a grace period — and the one shown has to be the
 * one that needs action. Payment problems outrank everything: that user loses
 * access on a deadline and is the only one here who must do something today.
 */
function deriveStatus(
  sub: {
    isActive: boolean;
    willRenew: boolean;
    periodType: string;
    billingIssuesDetectedAt: string | null;
    gracePeriodExpiresDate: string | null;
    unsubscribeDetectedAt: string | null;
    autoResumeDate: string | null;
  },
  now: number,
): SubscriptionStatus {
  const graceEndsAt = sub.gracePeriodExpiresDate ? Date.parse(sub.gracePeriodExpiresDate) : null;
  const inGrace = graceEndsAt != null && graceEndsAt > now;

  if (sub.billingIssuesDetectedAt) return inGrace ? 'grace' : sub.isActive ? 'billing_issue' : 'expired';
  if (sub.autoResumeDate) return 'paused';
  if (!sub.isActive) return 'expired';
  if (sub.unsubscribeDetectedAt || !sub.willRenew) return 'cancelled';
  if (sub.periodType === 'TRIAL') return 'trial';
  if (sub.periodType === 'INTRO') return 'intro';
  return 'active';
}

/**
 * @param platform  'ios' | 'android' — passed in rather than read from
 *                  react-native so this stays a pure function.
 * @param now       injectable for deterministic grace-period tests.
 */
export function describeSubscription(
  info: CustomerInfo | null | undefined,
  platform: string,
  managementURL: string | null,
  now: number = Date.now(),
): SubscriptionSummary {
  if (!info) return EMPTY_SUMMARY;

  const productIdentifier = pickProductIdentifier(info);
  if (!productIdentifier) return EMPTY_SUMMARY;

  const sub = info.subscriptionsByProductIdentifier?.[productIdentifier];
  if (!sub) {
    // A non-subscription (lifetime) purchase or a promo grant: there is an
    // entitlement but no subscription record behind it. Report the tier and
    // nothing else rather than inventing renewal dates.
    return {
      ...EMPTY_SUMMARY,
      status: 'active',
      tier: tierForProduct(info, productIdentifier),
      productIdentifier,
      managementURL,
    };
  }

  const store = mapStore(sub.store);
  const devicePlatformStore: BillingStore | null =
    platform === 'ios' ? 'app_store' : platform === 'android' ? 'play_store' : null;

  return {
    status: deriveStatus(sub, now),
    tier: tierForProduct(info, productIdentifier),
    productIdentifier,
    displayName: sub.displayName ?? null,
    store,
    expiresAt: sub.expiresDate ?? null,
    willRenew: sub.willRenew,
    gracePeriodExpiresAt: sub.gracePeriodExpiresDate ?? null,
    autoResumeAt: sub.autoResumeDate ?? null,
    isFamilyShared: sub.ownershipType === 'FAMILY_SHARED',
    manageableHere: store != null && store === devicePlatformStore,
    managementURL,
    isSandbox: sub.isSandbox,
  };
}
