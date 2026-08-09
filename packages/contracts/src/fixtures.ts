import type { Category } from './types';

export const categoryFixtures: Category[] = [
  { id: 1, name: 'Travel & Transit', is_default: true, is_system: false },
  { id: 2, name: 'Meals & Entertainment', is_default: true, is_system: false },
  { id: 3, name: 'Office Supplies', is_default: true, is_system: false },
  { id: 4, name: 'Software & IT', is_default: true, is_system: false },
  { id: 5, name: 'Vehicle Expenses', is_default: true, is_system: false },
  { id: 6, name: 'Advertising & Marketing', is_default: true, is_system: false },
  { id: 7, name: 'Professional Services', is_default: true, is_system: false },
  { id: 8, name: 'Utilities & Telecom', is_default: true, is_system: false },
  { id: 9, name: 'Inventory & Materials', is_default: true, is_system: false },
  { id: 10, name: 'Miscellaneous', is_default: true, is_system: true },
];

export const extractRequestFixture = {
  capture_id: '11111111-1111-4111-8111-111111111111',
  mode: 'default',
  captured_at: '2026-07-19T00:00:00.000Z',
  image: {
    uri: 'file:///receiptflow/fixtures/receipt.jpg',
    content_type: 'image/jpeg',
    byte_size: 183_000,
  },
} as const;

export const extractionResultFixture = {
  merchant: 'Whole Foods Market',
  txn_date: '2026-07-01',
  currency: 'USD',
  total: 73.36,
  line_items: [{ name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 }],
  suggested_category: 'Meals & Entertainment',
  is_receipt: true,
} as const;

export const malformedExtractionFixture =
  '{"merchant":"Whole Foods Market","txn_date":"2026-07-01","currency":"USD","total":73.36,"line_items":[{"name":"Organic bananas 1.2 lb","qty":1,"amount":1.74}],"suggested_category":"Meals & Entertainment","is_receipt":true';

export const offListCategoryExtractionFixture = {
  merchant: 'City Hardware',
  txn_date: '2026-07-01',
  currency: 'USD',
  total: 28.42,
  line_items: [{ name: 'Shelf brackets', qty: 2, amount: 28.42 }],
  suggested_category: 'Home Improvement',
  is_receipt: true,
} as const;

export const nonReceiptExtractionFixture = {
  merchant: 'Rejected image',
  txn_date: '2026-07-01',
  currency: 'USD',
  total: 0,
  line_items: [],
  suggested_category: 'Miscellaneous',
  is_receipt: false,
} as const;

/* ------------------------------------------------------------------ *
 * B8 — RevenueCat webhook fixtures
 *
 * Shaped like real RevenueCat deliveries so the gate exercises the webhook
 * without a store round-trip. The auth header is NOT baked in: it is the
 * RC_WEBHOOK_AUTH secret, supplied from env by whatever posts these.
 * ------------------------------------------------------------------ */

const RC_FIXTURE_USER = '22222222-2222-4222-8222-222222222222';

/** 2026-08-08T00:00:00Z — the period start every fixture below counts from. */
const RC_PERIOD_START_MS = 1_786_147_200_000;
const RC_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export const rcInitialPurchaseFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-initial-0001',
    type: 'INITIAL_PURCHASE',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_pro_m',
    store: 'APP_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS,
    purchased_at_ms: RC_PERIOD_START_MS,
    expiration_at_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    price: 6.99,
    price_in_purchased_currency: 6.99,
    currency: 'USD',
    is_trial_period: false,
  },
} as const;

/**
 * The renewal that moves current_period_start forward — the quota window's
 * anchor (D16). A Pro user's 200 scans reset because THIS lands, not because a
 * calendar month passed.
 */
export const rcRenewalFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-renewal-0002',
    type: 'RENEWAL',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_pro_m',
    store: 'APP_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    purchased_at_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    expiration_at_ms: RC_PERIOD_START_MS + 2 * RC_MONTH_MS,
    price: 6.99,
    price_in_purchased_currency: 6.99,
    currency: 'USD',
    is_trial_period: false,
  },
} as const;

/** Google-side purchase of the uncapped tier, promo offering. */
export const rcGooglePurchaseFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-google-0003',
    type: 'INITIAL_PURCHASE',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_max_m_promo',
    store: 'PLAY_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS,
    purchased_at_ms: RC_PERIOD_START_MS,
    expiration_at_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    price: 10.99,
    price_in_purchased_currency: 10.99,
    currency: 'USD',
    is_trial_period: false,
  },
} as const;

/** Reverses the commission written by the initial purchase (Blueprint §11). */
export const rcRefundFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-refund-0004',
    type: 'REFUND',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_pro_m',
    store: 'APP_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS + 60_000,
    purchased_at_ms: RC_PERIOD_START_MS,
    expiration_at_ms: RC_PERIOD_START_MS + 60_000,
    price: -6.99,
    price_in_purchased_currency: -6.99,
    currency: 'USD',
    is_trial_period: false,
  },
} as const;

/** Ends the subscription; quota falls back to the free-tier ledger. */
export const rcExpirationFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-expiration-0005',
    type: 'EXPIRATION',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_pro_m',
    store: 'APP_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    expiration_at_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    currency: 'USD',
  },
} as const;

/**
 * Grace period: billing failed but access continues. `grace` counts as active
 * for quota, and only an EXPIRATION flips it off — never the client's clock.
 */
export const rcBillingIssueFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-billing-0006',
    type: 'BILLING_ISSUE',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_pro_m',
    store: 'APP_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS + RC_MONTH_MS,
    expiration_at_ms: RC_PERIOD_START_MS + RC_MONTH_MS + 3 * 24 * 60 * 60 * 1000,
    currency: 'USD',
  },
} as const;

/** An event type this build does not classify — logged, never state-changing. */
export const rcUnknownTypeFixture = {
  api_version: '1.0',
  event: {
    id: 'rc-evt-unknown-0007',
    type: 'SOME_FUTURE_EVENT',
    app_user_id: RC_FIXTURE_USER,
    product_id: 'parse_pro_m',
    store: 'APP_STORE',
    event_timestamp_ms: RC_PERIOD_START_MS,
    currency: 'USD',
  },
} as const;

export const rcWebhookFixtures = {
  initialPurchase: rcInitialPurchaseFixture,
  renewal: rcRenewalFixture,
  googlePurchase: rcGooglePurchaseFixture,
  refund: rcRefundFixture,
  expiration: rcExpirationFixture,
  billingIssue: rcBillingIssueFixture,
  unknownType: rcUnknownTypeFixture,
} as const;
