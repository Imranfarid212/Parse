// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Translating RevenueCat's vocabulary into ours.
 *
 * Everything here is a pure function over a parsed payload — no network, no
 * database, no env. That is deliberate: this is the part of the webhook most
 * likely to be wrong (someone else's field names, someone else's enums, two
 * stores that disagree), and pure functions are the part a test can pin down
 * exhaustively without a store account. The impure work lives in the function
 * itself, which is thin enough to read in one screen.
 */

export type StoreId = 'apple' | 'google' | 'test';

/**
 * RevenueCat's store names -> the `subscription_store` enum.
 *
 * TEST_STORE is RevenueCat's own simulated store: real SDK calls, real
 * entitlements and real webhooks with no Apple or Google account involved. It is
 * mapped rather than rejected because the alternative is that the entire
 * purchase path is untestable until two developer accounts exist — but it is
 * mapped to its OWN value, never folded into 'apple', so no revenue query can
 * mistake a test subscription for a sale.
 */
const STORE_MAP: Record<string, StoreId> = {
  APP_STORE: 'apple',
  MAC_APP_STORE: 'apple',
  PLAY_STORE: 'google',
  TEST_STORE: 'test',
};

/**
 * Stores we cannot honour (Amazon, Roku, Stripe, RC_BILLING, Paddle, …).
 * Returning null rather than defaulting to 'apple' makes an unsupported store a
 * recorded no-op instead of an entitlement granted against the wrong billing
 * system.
 */
export function mapStore(store: string | null | undefined): StoreId | null {
  if (!store) return null;
  return STORE_MAP[store.toUpperCase()] ?? null;
}

/**
 * SANDBOX or PRODUCTION. Anything that is not explicitly PRODUCTION is treated
 * as sandbox by the callers, because the safe default for "is this real money?"
 * is no.
 */
export function normalizeEnvironment(environment: string | null | undefined): 'SANDBOX' | 'PRODUCTION' {
  return String(environment ?? '').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
}

/**
 * Google Play reports a subscription as `productId:basePlanId` — for example
 * `parse_pro_m:parse-pro-m-base`. Apple sends the bare id. The catalogue is
 * keyed on the product, so the base plan suffix is dropped; if base plans ever
 * need to differ in what they grant, they become separate rows in `products`
 * and this line is what changes.
 */
export function normalizeProductId(productId: string | null | undefined): string | null {
  if (!productId) return null;
  const trimmed = productId.trim();
  if (!trimmed) return null;
  const [base] = trimmed.split(':');
  return base || null;
}

/** RevenueCat sends epoch milliseconds throughout. */
export function msToIso(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Event types that begin or extend a paid period, and so carry a period start. */
const PERIOD_STARTING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'TRANSFER']);

/**
 * The start of the billing period this event establishes, or null when it
 * establishes none.
 *
 * Only a real purchase moves the quota window (D16). A BILLING_ISSUE or an
 * EXPIRATION carries no new period, and returning `occurred_at` for them would
 * silently reset a capped user's monthly usage to zero — handing out a free
 * allowance every time a card was declined.
 */
export function periodStartFor(event: { type?: string; purchased_at_ms?: number | null }): string | null {
  if (!event?.type || !PERIOD_STARTING.has(event.type)) return null;
  return msToIso(event.purchased_at_ms);
}

/**
 * Gross amount for the ledger and for influencer commission.
 *
 * `price` is in the store's reporting currency and `price_in_purchased_currency`
 * is what the customer actually paid. Commission is 15% of gross revenue, so the
 * reporting figure is the right basis; the purchased-currency figure is kept in
 * `raw` for reconciliation. A refund arrives with a negative price, which flows
 * through to a negative commission — the reversal.
 */
export function grossFor(event: { price?: number | null; type?: string }): number | null {
  if (typeof event?.price !== 'number' || !Number.isFinite(event.price)) return null;
  if (event.type === 'REFUND') return -Math.abs(event.price);
  return event.price;
}

export type NormalizedRcEvent = {
  eventId: string;
  type: string;
  appUserId: string;
  productId: string | null;
  store: StoreId | null;
  environment: 'SANDBOX' | 'PRODUCTION';
  occurredAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  gross: number | null;
  currency: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Shape-checks and normalises one delivery.
 *
 * `app_user_id` must be our auth uid. RevenueCat also issues its own anonymous
 * ids ($RCAnonymousID:...) for users who never logged in; those cannot be
 * attributed to an account, so they are rejected here rather than being written
 * against a null user and quietly lost.
 */
export function normalizeEvent(payload: unknown): { ok: true; event: NormalizedRcEvent } | { ok: false; reason: string } {
  const event = (payload as { event?: Record<string, unknown> })?.event;
  if (!event || typeof event !== 'object') return { ok: false, reason: 'missing event object' };

  const eventId = typeof event.id === 'string' ? event.id.trim() : '';
  if (!eventId) return { ok: false, reason: 'missing event.id' };

  const type = typeof event.type === 'string' ? event.type.trim().toUpperCase() : '';
  if (!type) return { ok: false, reason: 'missing event.type' };

  const appUserId = typeof event.app_user_id === 'string' ? event.app_user_id.trim() : '';
  if (!UUID.test(appUserId)) return { ok: false, reason: 'app_user_id is not an account uuid' };

  const currency = typeof event.currency === 'string' && event.currency.length === 3
    ? event.currency.toUpperCase()
    : null;

  return {
    ok: true,
    event: {
      eventId,
      type,
      appUserId,
      productId: normalizeProductId(event.product_id as string | null),
      store: mapStore(event.store as string | null),
      environment: normalizeEnvironment(event.environment as string | null),
      occurredAt: msToIso(event.event_timestamp_ms as number | null) ?? new Date().toISOString(),
      periodStart: periodStartFor({ type, purchased_at_ms: event.purchased_at_ms as number | null }),
      periodEnd: msToIso(event.expiration_at_ms as number | null),
      gross: grossFor({ price: event.price as number | null, type }),
      currency,
    },
  };
}

/**
 * Constant-time string comparison for the shared webhook secret.
 *
 * `===` on secrets leaks their length and their common prefix through timing.
 * The exposure over the public internet is small but the fix costs nothing, and
 * this is the only thing standing between an anonymous caller and the ability to
 * grant themselves an entitlement.
 */
export function secureEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Length is compared without an early return so the loop below always runs.
  let mismatch = left.length === right.length ? 0 : 1;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}
