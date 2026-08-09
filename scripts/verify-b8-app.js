/**
 * B8 client source gate — T8.1, T8.3 and the client half of T8.5.
 *
 * The properties asserted here are the ones a simulator run cannot show you
 * without real store credentials, and the ones that are expensive to get wrong:
 * that no key is hardcoded, that no price is invented by the app, that the
 * deletion interstitial carries the exact compliance copy, and that both stores
 * are supported rather than just the one the developer happens to be on.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b8:app] ${message}`); };
const includes = (source, needle, label) => {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
};
const excludes = (source, needle, label) => {
  if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`);
};

const config = read('src/lib/billing/config.ts');
const purchases = read('src/lib/billing/purchases.ts');
const entitlements = read('src/lib/billing/entitlement-store.tsx');
const offerings = read('src/lib/billing/use-plan-offerings.ts');
const plan = read('src/components/menu/PlanScreen.tsx');
const deleteScreen = read('src/components/menu/DeleteAccountScreen.tsx');
const settings = read('src/components/menu/SettingsScreen.tsx');
const layout = read('src/app/_layout.tsx');
const camera = read('src/app/camera.tsx');
const copy = read('packages/contracts/src/copy.ts');
const authContext = read('src/lib/auth/auth-context.tsx');

// --- both platforms, no hardcoded keys (T8.1) -------------------------------
includes(config, 'EXPO_PUBLIC_RC_APPLE_KEY', 'the iOS key comes from env');
includes(config, 'EXPO_PUBLIC_RC_GOOGLE_KEY', 'the Android key comes from env');
includes(config, 'Platform.select', 'the key is chosen per platform');
includes(config, 'billingAvailable', 'a keyless build is a supported state, not a crash');

// A publishable RevenueCat key looks like appl_xxx / goog_xxx. Neither may
// appear as a literal anywhere in the app.
for (const [file, source] of Object.entries({ config, purchases, entitlements, offerings, plan })) {
  for (const prefix of ['appl_', 'goog_', 'sk_', 'rcb_']) {
    excludes(source, prefix, `${file}: no literal API key`);
  }
}
// The secret key is server-only and must never be reachable from the bundle.
for (const [file, source] of Object.entries({ config, purchases, entitlements, plan })) {
  excludes(source, 'RC_SECRET_API_KEY', `${file}: the secret key must never reach the client`);
}

// --- prices come from the store, never from the app (T8.3) ------------------
includes(offerings, 'pkg.product.priceString', 'prices are the store\'s own formatted strings');
includes(offerings, "identifier.split(':')[0]", 'Android base-plan suffixes are handled');
includes(offerings, 'productId(tier, term, offering)', 'packages are matched by product id, not package type');
includes(plan, 'selected.priceString', 'the Subscribe button shows the store price');
// Subscribe must be unpressable without a real package behind it. Since the
// design system moved this to <PrimaryButton>, the guarantee now spans two
// files, so both halves are asserted: the screen passes the disabled state, and
// the primitive honours it. Checking only the screen would leave the property
// silently dependent on a component that could stop disabling itself.
includes(plan, 'busy={busy || !purchasable}', 'Subscribe is disabled with no purchasable product behind it');
includes(
  read('src/components/menu/primitives.tsx'),
  'disabled={busy}',
  'PrimaryButton actually disables when busy — the other half of that guarantee',
);

// The mock's hardcoded prices must be gone. A number the app prints next to a
// currency symbol is a price it is promising to charge, and only the store can
// make that promise.
//
// Checked against the source with comments stripped. Prose is allowed to
// mention a price or an allowance while explaining why it must not be typed
// into the code — the first version of this check failed on its own comment.
const planCode = plan.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const literal of ['9.99', '15.99', '6.99', '10.99', '49.99', '71.99', '79.99', '149.99']) {
  excludes(planCode, literal, 'no hardcoded price on the Plan screen');
}
includes(plan, 'MONTHLY_SCAN_CAP.pro', 'the advertised allowance is imported, not typed');
excludes(planCode, "'200 uploads", 'the allowance figure is interpolated from the catalogue');

// --- preview pricing can never reach a real user ----------------------------
// The design's reference prices exist so the screen is reviewable before the
// store accounts do. Three properties keep that safe, and all three are pinned
// here because the failure mode is showing someone a price nobody will honour.
const preview = read('src/lib/billing/preview-pricing.ts');
includes(preview, "process.env.EXPO_PUBLIC_ENV !== 'production'", 'preview pricing is impossible in production');
includes(preview, 'if (!previewPricingAllowed) return null', 'the guard is applied, not merely declared');
// A preview entry carries no package, so the purchase path cannot reach a store.
includes(offerings, 'priceString, pkg: null', 'preview entries have no purchasable package');
includes(offerings, 'empty && !loading && previewPricingAllowed', 'preview only applies when the store gave us nothing');
includes(plan, 'const purchasable = selected?.pkg != null', 'Subscribe requires a real package');
includes(plan, 'prices.preview &&', 'preview pricing is labelled on screen');
includes(plan, 'nothing here can be purchased', 'the label says it cannot be bought');
// The reference prices live in exactly one file, so there is one place to
// delete when the store goes live and one place for this gate to watch.
excludes(planCode, 'previewPriceFor', 'the screen does not reach for reference prices itself');

// --- the promo switch selects a real price list -----------------------------
includes(offerings, "startsWith('promo:')", 'the promo switch is driven by a real offering');
includes(plan, 'prices.hasPromo &&', 'the promo switch hides when there is no promo offering');
includes(purchases, 'offerings.all?.promo', 'the promo offering is fetched by identifier');

// --- entitlement is never the client's decision -----------------------------
includes(entitlements, 'refreshQuota', 'the server verdict is read, not assumed');
includes(entitlements, "state === 'active'", 'entitlements refresh on foreground');
includes(purchases, 'Purchases.logIn', 'the subscriber is tied to the auth uid so webhooks are attributable');
includes(layout, 'EntitlementProvider', 'the entitlement store is mounted');

// --- restore purchases (store requirement) ----------------------------------
includes(purchases, 'restorePurchases', 'restore is implemented');
includes(plan, 'COPY_RESTORE_PURCHASES', 'restore is reachable from the Plan screen');

// --- paywall routing (D8) ---------------------------------------------------
includes(camera, 'COPY_PAYWALL_MAX_TITLE', 'a capped Pro user is sold Max');
includes(camera, 'COPY_PAYWALL_PRO_TITLE', 'a free user is sold Pro');
includes(camera, "entitlements.tier === 'pro'", 'the paywall follows the tier held');

// --- deletion interstitial (T8.5) -------------------------------------------
includes(settings, 'Delete Account', 'deletion is reachable in-app');
includes(settings, 'DeleteAccountScreen', 'deletion goes through the interstitial');
includes(deleteScreen, 'COPY_DELETE_ACCOUNT_BILLING_WARNING', 'the billing warning is shown');
includes(deleteScreen, 'MANAGE_SUBSCRIPTION_URLS.apple', 'the App Store manage link is offered');
includes(deleteScreen, 'MANAGE_SUBSCRIPTION_URLS.google', 'the Google Play manage link is offered');
includes(deleteScreen, 'COPY_DELETE_ACCOUNT_RETENTION', 'the retention of financial records is disclosed');
includes(deleteScreen, 'auth.signOut', 'the local session is cleared after deletion');

// The warning has to say, in words, that billing continues. Store reviewers
// read this string; paraphrasing it is how the requirement quietly lapses.
includes(copy, 'does not cancel your subscription', 'the warning states billing continues');
includes(copy, 'Billing continues until you cancel it with the store', 'the warning says who to cancel with');

// Copy must be imported from contracts, never retyped in the screen.
excludes(deleteScreen, 'Deleting your Parse account does not cancel', 'deletion copy is imported, not retyped');

// --- Apple revocation is possible at all ------------------------------------
// Without capturing the authorization code at sign-in there is no refresh token
// to revoke, and account-delete can only ever report apple_revoked: false.
includes(authContext, 'credential.authorizationCode', 'the Apple authorization code is captured at sign-in');
includes(authContext, "invoke('apple-link'", 'the code is exchanged for a revocable refresh token');

console.log('[b8:app] ok — keys, prices, entitlements, paywall routing and deletion copy verified');
