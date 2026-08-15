// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * rc-webhook — RevenueCat is the only caller.
 *
 * This is the ONLY thing that grants an entitlement. The client never tells the
 * server what it bought: it tells RevenueCat, RevenueCat tells the store, the
 * store tells RevenueCat, and RevenueCat tells us here. A client claiming "I am
 * Pro now" is not evidence and is never acted on — can_scan() reads the
 * subscriptions row this function writes, and nothing else writes it.
 *
 * Everything that changes state happens inside apply_rc_event() so the four
 * writes (payment event, subscription, commission, tombstone check) commit
 * together. This function's whole job is: prove the caller is RevenueCat,
 * translate the payload, hand it to the RPC.
 *
 * Retry semantics matter as much as correctness. RevenueCat re-delivers on any
 * non-2xx, so:
 *   - bad secret        401, no retry wanted, nothing happened
 *   - unparseable       400, retrying will not help
 *   - duplicate         200, we already have it
 *   - tombstoned        200, deliberately not applied
 *   - database failure  500, PLEASE retry — this is the one case where losing
 *                       the event loses money
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

import { normalizeEvent, secureEquals } from '../_shared/revenuecat.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { code: 'VALIDATION_FAILED', message: 'POST only' });

  const expectedAuth = Deno.env.get('RC_WEBHOOK_AUTH');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // A missing secret must never mean "allow everyone". It means this deployment
  // is misconfigured, and the safe reading of that is to accept nothing.
  if (!expectedAuth || !supabaseUrl || !serviceRoleKey) {
    console.error('[rc-webhook] refused: server env incomplete');
    return json(500, { code: 'VALIDATION_FAILED', message: 'server not configured' });
  }

  const presented = req.headers.get('Authorization') ?? '';
  if (!secureEquals(presented, expectedAuth)) {
    // No detail in the response and no secret in the log: an attacker learns
    // only that they were refused.
    console.warn('[rc-webhook] rejected an unauthorized delivery');
    return json(401, { status: 401, code: 'UNAUTHORIZED' });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { status: 400, code: 'VALIDATION_FAILED', message: 'body is not JSON' });
  }

  const normalized = normalizeEvent(payload);
  if (!normalized.ok) {
    // 400 rather than 500: redelivering the same malformed body cannot succeed,
    // so asking RevenueCat to retry it forever helps nobody.
    console.warn('[rc-webhook] unusable payload', { reason: normalized.reason });
    return json(400, { status: 400, code: 'VALIDATION_FAILED', message: normalized.reason });
  }

  const event = normalized.event;

  // Test Store events grant entitlements without money changing hands, so a
  // production deployment must never honour one. Opt-in rather than opt-out:
  // staging sets RC_ALLOW_TEST_STORE=1, production simply does not, and a
  // deployment that forgets to think about it gets the safe answer.
  //
  // 200 rather than an error — the delivery was well-formed and there is nothing
  // for RevenueCat to retry.
  if (event.store === 'test' && Deno.env.get('RC_ALLOW_TEST_STORE') !== '1') {
    console.warn('[rc-webhook] refused a Test Store event on a deployment that does not allow them', {
      event_id: event.eventId,
      type: event.type,
    });
    return json(200, { status: 200, applied: false, reason: 'test_store_not_allowed' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await admin.rpc('apply_rc_event', {
      p_event_id: event.eventId,
      p_type: event.type,
      p_user_id: event.appUserId,
      p_product_id: event.productId,
      p_store: event.store,
      p_occurred_at: event.occurredAt,
      p_period_start: event.periodStart,
      p_period_end: event.periodEnd,
      p_gross: event.gross,
      p_currency: event.currency,
      // The verbatim delivery. Blueprint §7 asks for it, and when a payout is
      // ever disputed this row is the evidence.
      p_raw: payload,
      p_environment: event.environment,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const applied = row?.out_applied === true;

    // No PII, no tokens — event id, type and outcome only (§13.1).
    console.log('[rc-webhook] handled', {
      event_id: event.eventId,
      type: event.type,
      store: event.store,
      environment: event.environment,
      product_id: event.productId,
      applied,
      reason: row?.out_reason ?? null,
    });

    return json(200, { status: 200, applied, reason: row?.out_reason ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 500 so RevenueCat redelivers. The rc_event_id UNIQUE makes that safe: the
    // retry either completes the work or reports it as a duplicate.
    console.error('[rc-webhook] apply failed', { event_id: event.eventId, type: event.type, message });
    return json(500, { status: 500, code: 'VALIDATION_FAILED', message });
  }
});
