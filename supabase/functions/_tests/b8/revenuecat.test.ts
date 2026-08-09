// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * B8 — the RevenueCat translation layer, exhaustively.
 *
 * This is the part of the webhook that a store account cannot help you test:
 * every case here is someone else's field name, someone else's enum, or two
 * stores disagreeing. Getting one wrong grants the wrong entitlement or resets
 * someone's monthly allowance, and neither shows up in a sandbox purchase.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  grossFor,
  mapStore,
  msToIso,
  normalizeEvent,
  normalizeEnvironment,
  normalizeProductId,
  periodStartFor,
  secureEquals,
} from '../../_shared/revenuecat.ts';

Deno.test('mapStore translates both stores and refuses the rest', () => {
  assertEquals(mapStore('APP_STORE'), 'apple');
  assertEquals(mapStore('MAC_APP_STORE'), 'apple');
  assertEquals(mapStore('PLAY_STORE'), 'google');
  assertEquals(mapStore('app_store'), 'apple', 'case is not significant');
  // Not defaulting to a store is the point: granting an Apple entitlement for
  // an Amazon purchase would be worse than recording nothing.
  // The Test Store is honoured but kept distinct, so no revenue query can
  // mistake a simulated subscription for a sale.
  assertEquals(mapStore('TEST_STORE'), 'test');
  assertEquals(mapStore('AMAZON'), null);
  assertEquals(mapStore('RC_BILLING'), null);
  assertEquals(mapStore('PADDLE'), null);
  assertEquals(mapStore('ROKU'), null);
  assertEquals(mapStore('PROMOTIONAL'), null);
  assertEquals(mapStore('STRIPE'), null);
  assertEquals(mapStore(null), null);
  assertEquals(mapStore(''), null);
});

Deno.test('normalizeProductId strips the Play base plan suffix', () => {
  assertEquals(normalizeProductId('parse_pro_m'), 'parse_pro_m');
  assertEquals(normalizeProductId('parse_pro_m:parse-pro-m-base'), 'parse_pro_m');
  assertEquals(normalizeProductId('  parse_max_y_promo  '), 'parse_max_y_promo');
  assertEquals(normalizeProductId(null), null);
  assertEquals(normalizeProductId(''), null);
});

Deno.test('msToIso rejects the values that are not timestamps', () => {
  assertEquals(msToIso(1_786_147_200_000), '2026-08-08T00:00:00.000Z');
  assertEquals(msToIso(0), null, 'epoch zero is RevenueCat saying "absent"');
  assertEquals(msToIso(-1), null);
  assertEquals(msToIso(null), null);
  assertEquals(msToIso(Number.NaN), null);
  assertEquals(msToIso(Number.POSITIVE_INFINITY), null);
});

Deno.test('only a real purchase carries a period start', () => {
  const purchased_at_ms = 1_786_147_200_000;
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'TRANSFER']) {
    assertEquals(periodStartFor({ type, purchased_at_ms }), '2026-08-08T00:00:00.000Z', type);
  }
  // The regression this pins: a BILLING_ISSUE that carried a period start would
  // move the quota window and hand a capped user a fresh allowance every time
  // their card was declined.
  for (const type of ['BILLING_ISSUE', 'EXPIRATION', 'CANCELLATION', 'SUBSCRIPTION_PAUSED', 'REFUND']) {
    assertEquals(periodStartFor({ type, purchased_at_ms }), null, type);
  }
});

Deno.test('a refund is always negative gross', () => {
  assertEquals(grossFor({ price: 6.99, type: 'INITIAL_PURCHASE' }), 6.99);
  assertEquals(grossFor({ price: -6.99, type: 'REFUND' }), -6.99);
  // RevenueCat has sent refunds with a positive price; the sign is forced so a
  // reversal can never be written as another accrual.
  assertEquals(grossFor({ price: 6.99, type: 'REFUND' }), -6.99);
  assertEquals(grossFor({ price: null, type: 'EXPIRATION' }), null);
});

Deno.test('normalizeEvent accepts a real delivery', () => {
  const result = normalizeEvent({
    event: {
      id: 'rc-evt-1',
      type: 'initial_purchase',
      app_user_id: '22222222-2222-4222-8222-222222222222',
      product_id: 'parse_pro_m:base',
      store: 'PLAY_STORE',
      event_timestamp_ms: 1_786_147_200_000,
      purchased_at_ms: 1_786_147_200_000,
      expiration_at_ms: 1_788_739_200_000,
      price: 6.99,
      currency: 'usd',
    },
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.event.type, 'INITIAL_PURCHASE');
  assertEquals(result.event.productId, 'parse_pro_m');
  assertEquals(result.event.store, 'google');
  assertEquals(result.event.currency, 'USD');
  assertEquals(result.event.periodStart, '2026-08-08T00:00:00.000Z');
  assertEquals(result.event.gross, 6.99);
});

Deno.test('normalizeEvent refuses what cannot be attributed', () => {
  const reject = (payload: unknown) => {
    const result = normalizeEvent(payload);
    assertEquals(result.ok, false);
  };

  reject({});
  reject({ event: {} });
  reject({ event: { id: 'x', type: 'RENEWAL' } });
  // A RevenueCat anonymous id belongs to no account. Writing it against a null
  // user would lose the purchase silently.
  reject({ event: { id: 'x', type: 'RENEWAL', app_user_id: '$RCAnonymousID:abc123' } });
  reject({ event: { id: 'x', type: 'RENEWAL', app_user_id: 'not-a-uuid' } });
  reject({ event: { id: '', type: 'RENEWAL', app_user_id: '22222222-2222-4222-8222-222222222222' } });
});

Deno.test('secureEquals is correct as well as constant-time', () => {
  assertEquals(secureEquals('Bearer hunter2', 'Bearer hunter2'), true);
  assertEquals(secureEquals('Bearer hunter2', 'Bearer hunter3'), false);
  assertEquals(secureEquals('', ''), true);
  // Length must not short-circuit — a prefix that matches is still a mismatch.
  assertEquals(secureEquals('Bearer hunter', 'Bearer hunter2'), false);
  assertEquals(secureEquals('Bearer hunter2', 'Bearer hunter'), false);
  assertEquals(secureEquals('', 'Bearer hunter2'), false);
});

Deno.test('environment defaults to sandbox unless production is stated', () => {
  assertEquals(normalizeEnvironment('PRODUCTION'), 'PRODUCTION');
  assertEquals(normalizeEnvironment('production'), 'PRODUCTION');
  assertEquals(normalizeEnvironment('SANDBOX'), 'SANDBOX');
  // The safe answer to "is this real money?" is no, so anything unrecognised —
  // a missing field, a new value — is sandbox. Commission accrues only on
  // PRODUCTION, and this is what stops a test renewal owing someone 15%.
  assertEquals(normalizeEnvironment(null), 'SANDBOX');
  assertEquals(normalizeEnvironment(undefined), 'SANDBOX');
  assertEquals(normalizeEnvironment('anything-else'), 'SANDBOX');
});

Deno.test('a Test Store purchase normalizes into a usable event', () => {
  const result = normalizeEvent({
    event: {
      id: 'rc-evt-test-1',
      type: 'INITIAL_PURCHASE',
      app_user_id: '22222222-2222-4222-8222-222222222222',
      product_id: 'parse_pro_m',
      store: 'TEST_STORE',
      environment: 'SANDBOX',
      purchased_at_ms: 1_786_147_200_000,
      price: 9.99,
      currency: 'USD',
    },
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  // Before this, TEST_STORE mapped to null, the subscriptions insert violated a
  // NOT NULL constraint, and the webhook 500'd — which RevenueCat retries for
  // ever. The whole test-store path was unusable.
  assertEquals(result.event.store, 'test');
  assertEquals(result.event.environment, 'SANDBOX');
  assertEquals(result.event.periodStart, '2026-08-08T00:00:00.000Z');
});
