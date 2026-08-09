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
import Purchases, {
  LOG_LEVEL,
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
import { billingAvailable, revenueCatApiKey, usingTestStore } from '@/lib/billing/config';

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
