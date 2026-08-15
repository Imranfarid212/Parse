/**
 * RevenueCat configuration — where the keys come from, and when billing is
 * available at all.
 *
 * The two SDK keys are per-platform and are read from the environment. They are
 * publishable keys (they identify the app to RevenueCat and can only read
 * offerings and start purchases), which is why they are EXPO_PUBLIC_ and ship in
 * the bundle. The SECRET key never appears in the app under any circumstance —
 * it lives in the edge functions, where it is used to unlink a subscriber during
 * account deletion.
 *
 * Nothing here is hardcoded. A build without keys is a build without billing,
 * and every caller is written to handle that rather than crash: the Plan screen
 * shows its unavailable state, the paywall declines to open, and can_scan() on
 * the server is unaffected — a user's existing entitlement keeps working because
 * entitlement lives in the database, not in this SDK.
 */
import { Platform } from 'react-native';

/**
 * Purchases needs native code, so it cannot run in Expo Go. Guarding on the
 * key's presence rather than on the runtime keeps one code path: a dev client
 * without keys behaves exactly like Expo Go, which is the situation most of the
 * time before the store accounts exist.
 */
const platformKey: string | null =
  (Platform.select({
    ios: process.env.EXPO_PUBLIC_RC_APPLE_KEY,
    android: process.env.EXPO_PUBLIC_RC_GOOGLE_KEY,
    default: undefined,
  }) ?? null) || null;

/**
 * RevenueCat's Test Store key.
 *
 * It is not a platform key — one key serves both platforms — and it exercises
 * the entire purchase path (offerings, prices, purchases, entitlements,
 * webhooks) with no Apple or Google developer account. That makes it the only
 * way to test money before those accounts exist.
 *
 * It is refused in production builds, and the server refuses Test Store webhook
 * events too unless RC_ALLOW_TEST_STORE=1. Two independent locks, because a test
 * key reaching production would hand out real entitlements for free.
 */
const testStoreKey: string | null =
  process.env.EXPO_PUBLIC_ENV !== 'production'
    ? (process.env.EXPO_PUBLIC_RC_TEST_KEY ?? null) || null
    : null;

/**
 * The platform key always wins where one exists, so adding real store keys later
 * switches the app over with no code change and no risk of a stale test key
 * shadowing them.
 */
export const revenueCatApiKey: string | null = platformKey ?? testStoreKey;

/** True when the app is running against RevenueCat's simulated store. */
export const usingTestStore = revenueCatApiKey != null && revenueCatApiKey === testStoreKey;

/** True when this build can talk to RevenueCat at all. */
export const billingAvailable = revenueCatApiKey != null;

/**
 * Where a user manages or cancels their subscription.
 *
 * Deletion has to offer BOTH (Blueprint §13.2), not just the current platform's:
 * someone can subscribe on an iPhone and delete their account from an Android
 * tablet, and the link they need is the one for the store that charges them —
 * which this app cannot always know.
 */
export const MANAGE_SUBSCRIPTION_URLS = {
  apple: 'https://apps.apple.com/account/subscriptions',
  google: 'https://play.google.com/store/account/subscriptions',
} as const;
