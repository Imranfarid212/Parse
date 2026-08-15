-- B8 — apply_rc_event records the environment.
--
-- Separate migration from the enum change on purpose: PostgreSQL will not let a
-- new enum value be USED in the same transaction that adds it, and Supabase runs
-- each migration file in one transaction. Splitting them keeps `test` safely
-- committed before anything can reference it.

create or replace function public.apply_rc_event(
  p_event_id     text,
  p_type         text,
  p_user_id      uuid,
  p_product_id   text,
  p_store        text,
  p_occurred_at  timestamptz,
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_gross        numeric,
  p_currency     text,
  p_raw          jsonb,
  p_environment  text default null
)
returns table (out_applied boolean, out_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_financial_ref uuid;
  v_event_id      uuid;
  v_known_product boolean;
  v_status        subscription_status;
  v_code_id       uuid;
  v_rate          numeric;
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
      (rc_event_id, user_id, subject_ref, type, gross_amount, currency, store, occurred_at, raw, environment)
    values
      (p_event_id, null, v_financial_ref, p_type, p_gross, p_currency, p_store, p_occurred_at,
       coalesce(p_raw, '{}'::jsonb), p_environment)
    on conflict (rc_event_id) do nothing;
    return query select false, 'tombstoned'::text;
    return;
  end if;

  insert into public.payment_events
    (rc_event_id, user_id, type, gross_amount, currency, store, occurred_at, raw, environment)
  values
    (p_event_id, p_user_id, p_type, p_gross, p_currency, p_store, p_occurred_at,
     coalesce(p_raw, '{}'::jsonb), p_environment)
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
      product_id = excluded.product_id,
      status = excluded.status,
      -- Only a real billing period moves the window. An EXPIRATION or a
      -- BILLING_ISSUE carries no new period, and letting it overwrite the start
      -- would silently reset a Pro user's monthly allowance to zero used.
      current_period_start = case
        when excluded.status = 'active' then excluded.current_period_start
        else public.subscriptions.current_period_start
      end,
      current_period_end = coalesce(excluded.current_period_end, public.subscriptions.current_period_end),
      offering = excluded.offering,
      updated_at = now();
  end if;

  -- Influencer commission (Blueprint §11): 15% of gross, one row per payment
  -- event, refunds append a reversal rather than editing the original.
  --
  -- Never accrued on sandbox money. Test Store subscriptions renew every few
  -- minutes, so without this an afternoon of testing would owe an influencer a
  -- commission on dozens of purchases that never happened.
  select rc.id, rc.commission_rate
    into v_code_id, v_rate
    from public.referrals r
    join public.referral_codes rc on rc.id = r.code_id
   where r.referred_user_id = p_user_id
     and rc.kind = 'influencer'
     and rc.commission_rate is not null
   limit 1;

  if v_code_id is not null and p_gross is not null and p_gross <> 0
     and coalesce(p_environment, 'PRODUCTION') = 'PRODUCTION'
     and p_type in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'REFUND') then
    insert into public.commission_ledger (code_id, payment_event_id, commission_amount, status)
    values (
      v_code_id,
      v_event_id,
      round(p_gross * v_rate, 2),
      case when p_type = 'REFUND' then 'reversed' else 'accrued' end
    )
    on conflict (payment_event_id) do nothing;
  end if;

  return query select true, lower(p_type);
end;
$$;

-- The old 11-argument signature would otherwise linger as an overload and be
-- chosen by any caller that has not been updated, silently dropping the
-- environment.
drop function if exists public.apply_rc_event(text, text, uuid, text, text, timestamptz, timestamptz, timestamptz, numeric, text, jsonb);

revoke all on function public.apply_rc_event(text, text, uuid, text, text, timestamptz, timestamptz, timestamptz, numeric, text, jsonb, text) from public;
grant execute on function public.apply_rc_event(text, text, uuid, text, text, timestamptz, timestamptz, timestamptz, numeric, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
