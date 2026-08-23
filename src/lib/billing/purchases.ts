/**
 * The RevenueCat SDK wrapper — the only file in the app that imports
 * react-native-purchases.
 *
 * Everything is funnelled through here so the rest of the app never has to know
 * whether billing is configured, which platform it is on, or what RevenueCat's
 * types look like. Callers get plain objects and never see a thrown SDK error
 * for the ordinary cases (no keys, user cancelled, nothing to restore).
 *
 * One rule governs this whole layer: **the SDK is not the authority on what a
 * user is entitled to.** A purchase here is a purchase at the store; the
 * entitlement that matters is the `subscriptions` row the rc-webhook writes, and
 * can_scan() reads only that. The customer info below is used to make the UI
 * responsive — to stop showing a paywall the moment a purchase lands — never to
 * decide whether a scan is allowed. Trusting the client for that is how apps get
 * their entitlements forged.
 */
import { Linking, Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  REFUND_REQUEST_STATUS,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

import {
  ENTITLEMENT_MAX,
  ENTITLEMENT_PRO,
  type Offering,
  type Tier,
} from '@/../packages/contracts/src/products';
import {
  billingAvailable,
  MANAGE_SUBSCRIPTION_URLS,
  revenueCatApiKey,
  usingTestStore,
} from '@/lib/billing/config';

let configured = false;
let configuring: Promise<boolean> | null = null;

/**
 * Why billing is unavailable, when it is.
 *
 * "The store is not connected" was one message covering three unrelated causes —
 * no API key in the bundle, the native SDK missing from the binary, or the
 * dashboard returning no offerings. They need completely different fixes, and
 * guessing between them cost an afternoon, so the reason is now recorded and
 * shown in development builds.
 */
export type BillingDiagnosis =
  | 'ok'
  | 'no_key'
  | 'sdk_missing'
  | 'configure_failed'
  | 'offerings_empty'
  | 'offerings_error';

let diagnosis: BillingDiagnosis = 'ok';
let diagnosisDetail: string | null = null;

function setDiagnosis(next: BillingDiagnosis, detail?: unknown) {
  diagnosis = next;
  diagnosisDetail = detail == null ? null : detail instanceof Error ? detail.message : String(detail);
  if (__DEV__ && next !== 'ok') console.warn(`[billing] ${next}`, diagnosisDetail ?? '');
}

export function getBillingDiagnosis(): { code: BillingDiagnosis; detail: string | null } {
  return { code: diagnosis, detail: diagnosisDetail };
}

/** Human-readable, for a development-only line under the Plan screen. */
export function describeBillingDiagnosis(): string | null {
  switch (diagnosis) {
    case 'ok':
      // Not a fault — but after adding a platform key, "which store am I on?"
      // is exactly the question, and guessing from prices is unreliable.
      return usingTestStore ? 'Connected to the RevenueCat Test Store (no real money).' : null;
    case 'no_key':
      return 'No RevenueCat key in this bundle — set EXPO_PUBLIC_RC_TEST_KEY in .env and rebuild.';
    case 'sdk_missing':
      return 'The RevenueCat native module is missing from this build — run `npm run prebuild:ios` and reinstall the app.';
    case 'configure_failed':
      return `RevenueCat rejected the key: ${diagnosisDetail ?? 'unknown error'}`;
    case 'offerings_empty':
      return 'Connected, but the dashboard returned no offerings for this platform.';
    case 'offerings_error':
      return `Could not load offerings: ${diagnosisDetail ?? 'unknown error'}`;
  }
}

/**
 * Configures the SDK once per process.
 *
 * Resolves false — never throws — when billing is unavailable, so callers can
 * write `if (!(await ensureConfigured())) return` instead of wrapping every call
 * site in a try/catch that all say the same thing.
 */
export async function ensureConfigured(): Promise<boolean> {
  if (configured) return true;
  if (!billingAvailable || !revenueCatApiKey) {
    setDiagnosis('no_key');
    return false;
  }
  if (configuring) return configuring;

  configuring = (async () => {
    try {
      // The single most common failure: the JS package is installed but the app
      // binary predates it, so there is no native module behind these calls.
      // Checked explicitly because the error it otherwise throws is opaque.
      if (typeof Purchases?.configure !== 'function') {
        setDiagnosis('sdk_missing');
        return false;
      }
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
      // No appUserID here: the user may not be signed in yet. identify() below
      // attaches the account as soon as there is one, and RevenueCat merges the
      // anonymous purchase history into it.
      await Purchases.configure({ apiKey: revenueCatApiKey });
      configured = true;
      setDiagnosis('ok');
      return true;
    } catch (error) {
      // A missing native module surfaces here on some platforms instead.
      const message = error instanceof Error ? error.message : String(error);
      setDiagnosis(/native|NativeModule|null is not an object|undefined is not/i.test(message)
        ? 'sdk_missing'
        : 'configure_failed', error);
      return false;
    } finally {
      configuring = null;
    }
  })();

  return configuring;
}

/**
 * Ties RevenueCat's subscriber to our auth uid.
 *
 * This is what makes the webhook attributable: `app_user_id` on every event is
 * this value, and rc-webhook rejects any event whose app_user_id is not an
 * account uuid. Without this call purchases arrive under an anonymous RevenueCat
 * id and can never be matched to a user.
 */
export async function identify(userId: string): Promise<void> {
  if (!(await ensureConfigured())) return;
  try {
    await Purchases.logIn(userId);
  } catch (error) {
    if (__DEV__) console.warn('[billing] logIn failed', error);
  }
}

/** Detaches the subscriber on sign-out so the next user starts clean. */
export async function forgetUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // logOut throws when the current user is already anonymous. Nothing to do.
  }
}

export type OfferingPackages = {
  offering: Offering;
  /** Keyed `${tier}_${term}` — e.g. `pro_month`. */
  packages: Record<string, PurchasesPackage>;
};

/**
 * Fetches both price lists.
 *
 * RevenueCat's "current" offering is whatever the dashboard marks as default;
 * the promo list is fetched by identifier from `all`. A deployment that has not
 * created the promo offering yet simply gets no promo packages, and the Plan
 * screen keeps the switch hidden rather than showing prices it cannot charge.
 */
export async function fetchOfferings(): Promise<Record<Offering, PurchasesOffering | null>> {
  if (!(await ensureConfigured())) return { default: null, promo: null };
  try {
    const offerings = await Purchases.getOfferings();
    const result = {
      default: offerings.current ?? offerings.all?.default ?? null,
      promo: offerings.all?.promo ?? null,
    };
    // Configured and reachable but nothing came back: the key is fine and the
    // dashboard is the place to look, which is the opposite conclusion from
    // every other failure here.
    if (!result.default && !result.promo) setDiagnosis('offerings_empty');
    return result;
  } catch (error) {
    setDiagnosis('offerings_error', error);
    return { default: null, promo: null };
  }
}

export type PurchaseOutcome =
  | { status: 'purchased'; customerInfo: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'failed'; message: string };

/**
 * Runs a purchase.
 *
 * A user cancelling is not an error and must never surface as one — it is the
 * single most common outcome of opening a paywall. RevenueCat flags it on the
 * error object, and it is mapped to its own status here so no call site has to
 * remember to check.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!(await ensureConfigured())) return { status: 'unavailable' };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', customerInfo };
  } catch (error) {
    const cancelled = (error as { userCancelled?: boolean })?.userCancelled === true;
    if (cancelled) return { status: 'cancelled' };
    const message = error instanceof Error ? error.message : String(error);
    if (__DEV__) console.warn('[billing] purchase failed', message);
    return { status: 'failed', message };
  }
}

/**
 * Restore Purchases — required by both stores, and the only route back for a
 * user who reinstalled or switched device.
 */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!(await ensureConfigured())) return { status: 'unavailable' };
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { status: 'purchased', customerInfo };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', message };
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!(await ensureConfigured())) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Managing an existing subscription
 *
 * Everything money-touching — changing the payment method, upgrading,
 * cancelling, refunding — happens on Apple's or Google's own authenticated
 * screen, never in this app. There is no in-app path to a card by design: with
 * IAP the store is the merchant of record and the card is never exposed to us,
 * which is what keeps the whole feature outside PCI DSS scope. What follows is
 * routing to the right store screen, and nothing else.
 * ------------------------------------------------------------------ */

/**
 * Hosts allowed to be opened as a subscription-management destination.
 *
 * `managementURL` arrives in a network response. It is TLS-protected and comes
 * from RevenueCat, so the realistic risk is low — but an unvalidated URL handed
 * to `Linking.openURL` is a phishing primitive with unusually good odds: the
 * user tapped "manage subscription" in their own app, so they are primed to
 * trust whatever page loads and to type a store password into it. Validating
 * costs nothing and removes the class of bug entirely.
 */
const MANAGEMENT_HOSTS = /(^|\.)(apple\.com|google\.com)$/;

/**
 * Returns the URL only if it is https and points at a store host, else null.
 *
 * Fails closed: a URL that cannot be parsed is rejected rather than passed
 * through. `new URL` is used rather than a regex on purpose — it resolves
 * userinfo tricks like `https://apps.apple.com@evil.example/` to the real host,
 * which hand-rolled string matching reliably gets wrong.
 */
export function safeManagementURL(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return MANAGEMENT_HOSTS.test(parsed.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** Where this device's own store keeps its subscription settings. */
function platformManageURL(): string {
  return Platform.OS === 'ios' ? MANAGE_SUBSCRIPTION_URLS.apple : MANAGE_SUBSCRIPTION_URLS.google;
}

export type ManageOutcome = 'opened' | 'failed';

/**
 * Opens the store's manage-subscription screen.
 *
 * Three routes, in descending order of how good they feel:
 *
 *   1. `showManageSubscriptions()` presents Apple's sheet as a MODAL OVER the
 *      app on iOS 13+. This matters commercially: the alternative bounces the
 *      user into the App Store app, and a meaningful share of them never come
 *      back to finish what they opened. On Android it forwards to the Play
 *      subscriptions page, so the user does leave — Play has no in-app sheet.
 *   2. The validated `managementURL` RevenueCat computed for this subscriber.
 *   3. This platform's generic subscriptions page, which always exists.
 *
 * @param crossStoreURL  Set when the subscription is billed by the OTHER
 *   store — subscribed on an iPhone, opened on an Android tablet. The native
 *   sheet can only ever show the current device's store, so it is skipped
 *   entirely and the correct store's page is opened instead. Getting this wrong
 *   sends the user to a screen where their subscription simply is not listed.
 */
export async function openManageSubscriptions(crossStoreURL?: string | null): Promise<ManageOutcome> {
  if (crossStoreURL) {
    const url = safeManagementURL(crossStoreURL);
    if (url) {
      try {
        await Linking.openURL(url);
        return 'opened';
      } catch (error) {
        if (__DEV__) console.warn('[billing] cross-store manage link failed', error);
        return 'failed';
      }
    }
  }

  if (await ensureConfigured()) {
    try {
      await Purchases.showManageSubscriptions();
      return 'opened';
    } catch (error) {
      // Thrown on iOS < 13, on some Android configurations, and whenever the
      // native module is absent. Every one of those is a fallback, not a
      // failure to report.
      if (__DEV__) console.warn('[billing] showManageSubscriptions unavailable', error);
    }

    const fromSdk = safeManagementURL((await getCustomerInfo())?.managementURL);
    if (fromSdk) {
      try {
        await Linking.openURL(fromSdk);
        return 'opened';
      } catch {
        // Fall through to the generic page.
      }
    }
  }

  try {
    await Linking.openURL(platformManageURL());
    return 'opened';
  } catch (error) {
    if (__DEV__) console.warn('[billing] no manage route available', error);
    return 'failed';
  }
}

export type RefundOutcome = 'submitted' | 'cancelled' | 'unsupported' | 'failed';

/**
 * Presents Apple's in-app refund sheet for the active entitlement.
 *
 * iOS 15+ only — `beginRefundRequestForActiveEntitlement` throws
 * `UnsupportedPlatformException` on Android and older iOS, so the platform
 * check here is load-bearing, not defensive tidiness.
 *
 * Worth having because the alternative is a support email. Apple decides the
 * outcome, not us, and `submitted` means exactly that: Apple received the
 * request. It is never a confirmation that money moved.
 */
export async function requestRefund(): Promise<RefundOutcome> {
  if (Platform.OS !== 'ios') return 'unsupported';
  if (!(await ensureConfigured())) return 'unsupported';
  try {
    const status = await Purchases.beginRefundRequestForActiveEntitlement();
    if (status === REFUND_REQUEST_STATUS.USER_CANCELLED) return 'cancelled';
    return status === REFUND_REQUEST_STATUS.SUCCESS ? 'submitted' : 'failed';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unsupported|not available|iOS 15/i.test(message)) return 'unsupported';
    if (__DEV__) console.warn('[billing] refund request failed', message);
    return 'failed';
  }
}

/**
 * The tier RevenueCat believes this user holds, or null.
 *
 * Max wins when both are somehow active — during an upgrade the old entitlement
 * can linger for a moment, and showing the user the lesser of the two would be
 * wrong in the one direction that annoys a paying customer.
 */
export function tierFromCustomerInfo(info: CustomerInfo | null | undefined): Tier | null {
  const active = info?.entitlements?.active ?? {};
  if (active[ENTITLEMENT_MAX]) return 'max';
  if (active[ENTITLEMENT_PRO]) return 'pro';
  return null;
}

export type { CustomerInfo, PurchasesOffering, PurchasesPackage };
