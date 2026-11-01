-- PRODUCT_CHANGE must not move the subscription's product.
--
-- Identical to the previous definition except for the two CASE expressions in
-- the subscriptions upsert, and the reasoning for those is inline below.
--
-- Found by reading a real delivery rather than by a failing test, which is the
-- uncomfortable part: the existing suite applies PRODUCT_CHANGE and RENEWAL in
-- the order that happens to be safe, so it could never have caught this.
-- scripts/verify-b8-db.js now applies a PRODUCT_CHANGE on its own.

create or replace function public.apply_rc_event(
  p_event_id         text,
  p_type             text,
  p_user_id          uuid,
  p_product_id       text,
  p_store            text,
  p_occurred_at      timestamptz,
  p_period_start     timestamptz,
  p_period_end       timestamptz,
  p_gross            numeric,
  p_currency         text,
  p_raw              jsonb,
  p_environment      text default null,
  p_reporting_amount numeric default null,
  p_reporting_currency text default null,
  p_tax_percentage   numeric default null
)
returns table (out_applied boolean, out_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_financial_ref   uuid;
  v_event_id        uuid;
  v_known_product   boolean;
  v_status          subscription_status;
  v_code_id         uuid;
  v_rate            numeric;
  v_basis           numeric;
  v_basis_currency  text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  -- Tombstone FIRST (D17/§13.2). A renewal or refund can arrive days after the
  -- account is gone. The event is still recorded — it is money and it belongs in
  -- the books — but with user_id detached, so nothing downstream recreates a
  -- profile, a subscription or an entitlement for a user who deleted themselves.
  select t.financial_ref into v_financial_ref
    from public.account_tombstones t where t.user_id = p_user_id;

  if v_financial_ref is not null then
    -- Stamped with the tombstone's pseudonym so the five-year purge collects it
    -- with the rest of that account's records. Without the stamp this row would
    -- outlive the tombstone and never be collectable by anything.
    insert into public.payment_events
      (rc_event_id, user_id, subject_ref, type, gross_amount, currency, store, occurred_at, raw, environment,
       reporting_amount, reporting_currency, tax_percentage)
    values
      (p_event_id, null, v_financial_ref, p_type, p_gross, p_currency, p_store, p_occurred_at,
       coalesce(p_raw, '{}'::jsonb), p_environment,
       p_reporting_amount, p_reporting_currency, p_tax_percentage)
    on conflict (rc_event_id) do nothing;
    return query select false, 'tombstoned'::text;
    return;
  end if;

  insert into public.payment_events
    (rc_event_id, user_id, type, gross_amount, currency, store, occurred_at, raw, environment,
     reporting_amount, reporting_currency, tax_percentage)
  values
    (p_event_id, p_user_id, p_type, p_gross, p_currency, p_store, p_occurred_at,
     coalesce(p_raw, '{}'::jsonb), p_environment,
     p_reporting_amount, p_reporting_currency, p_tax_percentage)
  on conflict (rc_event_id) do nothing
  returning id into v_event_id;

  -- A redelivery. Everything below already ran for this event id, and running it
  -- again would double a commission.
  if v_event_id is null then
    return query select false, 'duplicate'::text;
    return;
  end if;

  select exists (select 1 from public.products p where p.id = p_product_id) into v_known_product;

  -- Map RevenueCat's event vocabulary onto subscription state.
  --
  -- CANCELLATION is deliberately absent: it means auto-renew was switched off,
  -- not that access ended. The user keeps what they paid for until EXPIRATION
  -- arrives. Treating a cancellation as an expiry would cut off a paying user
  -- mid-period, which is both wrong and the kind of thing that generates
  -- refund requests.
  v_status := case
    when p_type in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'TRANSFER') then 'active'
    when p_type in ('BILLING_ISSUE', 'SUBSCRIPTION_PAUSED') then 'grace'
    when p_type in ('EXPIRATION', 'REFUND') then 'expired'
    else null
  end::subscription_status;

  if v_status is not null and v_known_product then
    insert into public.subscriptions (
      user_id, store, product_id, status, current_period_start, current_period_end, offering, updated_at
    )
    select
      p_user_id,
      p_store::subscription_store,
      p_product_id,
      v_status,
      coalesce(p_period_start, p_occurred_at, now()),
      p_period_end,
      pr.offering,
      now()
    from public.products pr
    where pr.id = p_product_id
    on conflict (user_id) do update set
      store = excluded.store,
      -- A PRODUCT_CHANGE never sets the product. Its `product_id` is the plan
      -- the customer is LEAVING, and the plan they are moving to arrives on the
      -- RENEWAL that follows — immediately for an upgrade, at period end for a
      -- deferred crossgrade or downgrade.
      --
      -- Writing excluded.product_id here was wrong in a way that only shows up
      -- under a race. An immediate upgrade dispatches PRODUCT_CHANGE and RENEWAL
      -- together (they arrived 5ms apart on 2026-11-01) and webhook deliveries
      -- are concurrent POSTs with no ordering guarantee. In the order we happened
      -- to get, RENEWAL landed last and wrote the right product. Reversed, the
      -- PRODUCT_CHANGE overwrites it with the old one and nothing corrects that
      -- until the next renewal — a paying Max subscriber silently held at Pro's
      -- 200-scan cap for a month, because products drives can_scan().
      --
      -- Taking new_product_id instead would be worse, not better: on a deferred
      -- change it names a plan that does not apply yet, so it would downgrade
      -- someone a period early. Neither field belongs here. RENEWAL owns the
      -- product, and this clause simply declines to fight it.
      product_id = case
        when p_type = 'PRODUCT_CHANGE' then public.subscriptions.product_id
        else excluded.product_id
      end,
      status = excluded.status,
      -- Only a real billing period moves the window. An EXPIRATION or a
      -- BILLING_ISSUE carries no new period, and letting it overwrite the start
      -- would silently reset a Pro user's monthly allowance to zero used.
      current_period_start = case
        when excluded.status = 'active' then excluded.current_period_start
        else public.subscriptions.current_period_start
      end,
      current_period_end = coalesce(excluded.current_period_end, public.subscriptions.current_period_end),
      -- Offering follows the product for the same reason.
      offering = case
        when p_type = 'PRODUCT_CHANGE' then public.subscriptions.offering
        else excluded.offering
      end,
      updated_at = now();
  end if;

  -- Influencer commission (Blueprint §11): 15% of revenue, one row per payment
  -- event, refunds append a reversal rather than editing the original.
  --
  -- Accrued against the reporting amount, not the purchased amount. Two
  -- subscribers on the same product in different storefronts owe the same
  -- percentage of the same revenue; denominating one debt in CAD and the next in
  -- JPY would leave the ledger unable to answer what anybody is owed.
  --
  -- Never accrued on sandbox money. Test Store subscriptions renew every few
  -- minutes, so without this an afternoon of testing would owe an influencer a
  -- commission on dozens of purchases that never happened.
  -- The amount and its currency are chosen together, never coalesced
  -- independently. Falling back field by field is what produced the original
  -- defect: a reporting-currency amount carrying a purchase-currency label.
  -- Either the reporting pair is complete and it wins, or the purchased pair is
  -- used whole.
  if p_reporting_amount is not null and p_reporting_currency is not null then
    v_basis          := p_reporting_amount;
    v_basis_currency := p_reporting_currency;
  else
    v_basis          := p_gross;
    v_basis_currency := p_currency;
  end if;

  select rc.id, rc.commission_rate
    into v_code_id, v_rate
    from public.referrals r
    join public.referral_codes rc on rc.id = r.code_id
   where r.referred_user_id = p_user_id
     and rc.kind = 'influencer'
     and rc.commission_rate is not null
   limit 1;

  if v_code_id is not null and v_basis is not null and v_basis <> 0
     and coalesce(p_environment, 'PRODUCTION') = 'PRODUCTION'
     and p_type in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'REFUND') then
    insert into public.commission_ledger (code_id, payment_event_id, commission_amount, currency, status)
    values (
      v_code_id,
      v_event_id,
      round(v_basis * v_rate, 2),
      v_basis_currency,
      case when p_type = 'REFUND' then 'reversed' else 'accrued' end
    )
    on conflict (payment_event_id) do nothing;
  end if;

  return query select true, lower(p_type);
end;
$$;

-- The signature is unchanged from the previous migration, so there is no stale
-- overload to drop here. The grants are restated because CREATE OR REPLACE on a
-- SECURITY DEFINER function is the kind of thing that should never depend on
-- whatever an earlier migration happened to leave behind.
revoke all on function public.apply_rc_event(text, text, uuid, text, text, timestamptz, timestamptz, timestamptz, numeric, text, jsonb, text, numeric, text, numeric) from public;
grant execute on function public.apply_rc_event(text, text, uuid, text, text, timestamptz, timestamptz, timestamptz, numeric, text, jsonb, text, numeric, text, numeric) to service_role;

notify pgrst, 'reload schema';
