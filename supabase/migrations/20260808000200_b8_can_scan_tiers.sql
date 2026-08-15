-- B8 — can_scan() reads the allowance from the catalogue.
--
-- Everything the previous version guaranteed is unchanged and the comments that
-- explain WHY are preserved below, because those hazards have not gone away:
-- the profiles row is still the mutex, a missing profile still raises, and a
-- redelivered capture still must not move the counter. Read
-- 20260802000100_b4_can_scan_profile_guard.sql for the full reasoning.
--
-- Three things change:
--
--   1. The cap is no longer the literal 500 in this body. It is
--      products.monthly_scan_cap, joined through the subscription. A price or
--      allowance change is now an UPDATE, not a migration of this function.
--   2. The uncapped tier is no longer decided by matching one product id. It is
--      any product whose monthly_scan_cap is null, which is what "uncapped"
--      actually means.
--   3. New output out_deprioritized: true when an uncapped user is past their
--      fair-use threshold (D8). This does NOT refuse the scan. It is a flag the
--      caller may use to order work behind other users. Nothing in the UI is
--      allowed to render it as a block, because the tier is sold as unlimited.
--
-- The return type gains a column, so the function must be dropped and recreated
-- rather than replaced.

drop function if exists public.can_scan(uuid, uuid);

create function public.can_scan(p_user_id uuid, p_capture_id uuid)
returns table (
  out_allowed boolean,
  out_reason text,
  out_remaining int,
  out_paywall text,
  out_deprioritized boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_burst_per_min constant int := 12;
  v_tier          text;
  v_cap           int;
  v_fair_use      int;
  v_period        timestamptz;
  v_used          int;
  v_balance       int;
  v_recent        int;
  v_charged       int := 0;
  v_allowed       boolean := false;
  v_reason        text;
  v_remaining     int;
  v_paywall       text;
  v_deprioritized boolean := false;
begin
  -- Serialise this user's concurrent scans. Everything below reads and writes
  -- under this lock, so two parallel captures cannot both spend the last scan.
  -- The lock lives only as long as this function call, so it is never held
  -- across the model call that follows.
  --
  -- profiles is not read here and is never written; its row is purely the mutex,
  -- because the thing being protected — the balance — is an aggregate over
  -- scan_ledger and so has no row to lock. PERFORM matching no row would lock
  -- nothing AND raise nothing, running the whole function unserialised, so the
  -- absence of the row is asserted rather than assumed.
  perform 1 from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'can_scan: no profiles row for user %', p_user_id
      using errcode = 'no_data_found';
  end if;

  -- Keep the burst window small without needing a cron.
  delete from public.scan_attempts sa
   where sa.user_id = p_user_id and sa.created_at < now() - interval '10 minutes';

  select count(*) into v_recent
    from public.scan_attempts sa
   where sa.user_id = p_user_id and sa.created_at > now() - interval '1 minute';

  -- Counts every attempt we allowed, including ones later refunded for not
  -- being a receipt: a rejected image still costs a model call. A refused
  -- attempt is deliberately not recorded, so hammering the endpoint cannot
  -- extend a user's own lockout.
  if v_recent >= v_burst_per_min then
    return query select false, 'rate_limited'::text, null::int, 'pro'::text, false;
    return;
  end if;

  -- The allowance travels with the product, not with this function.
  select p.tier, p.monthly_scan_cap, p.fair_use_threshold, s.current_period_start
    into v_tier, v_cap, v_fair_use, v_period
    from public.subscriptions s
    join public.products p on p.id = s.product_id
   where s.user_id = p_user_id
     and s.status in ('active', 'grace')  -- grace counts as active; expiry flips on the webhook
   order by s.current_period_start desc nulls last
   limit 1;

  if v_tier is not null and v_cap is null then
    -- Uncapped tier. Always allowed; the period count only decides whether this
    -- user is past fair use.
    v_allowed := true;
    v_reason := 'max_unlimited';
    v_remaining := null;
    v_paywall := 'max';
    if v_fair_use is not null and v_period is not null then
      select count(*) into v_used
        from public.scan_ledger sl
       where sl.user_id = p_user_id and sl.reason = 'scan_used' and sl.created_at >= v_period;
      v_deprioritized := v_used >= v_fair_use;
    end if;

  elsif v_tier is not null and v_period is not null then
    -- current_period_start is authoritative for the billing window (D16). A
    -- renewal moves it; the calendar does not.
    select count(*) into v_used
      from public.scan_ledger sl
     where sl.user_id = p_user_id and sl.reason = 'scan_used' and sl.created_at >= v_period;
    v_remaining := greatest(0, v_cap - greatest(0, v_used));
    v_paywall := 'max';  -- a capped user is sold the uncapped tier (D8)
    if v_remaining > 0 then v_allowed := true;  v_reason := 'pro_within_cap';
    else                    v_allowed := false; v_reason := 'pro_cap_hit'; end if;

  else
    select coalesce(sum(sl.delta), 0) into v_balance
      from public.scan_ledger sl where sl.user_id = p_user_id;
    v_paywall := 'pro';
    if v_balance > 0 then v_allowed := true;  v_reason := 'free_balance';    v_remaining := v_balance;
    else                  v_allowed := false; v_reason := 'free_exhausted';  v_remaining := 0; end if;
  end if;

  if v_allowed then
    insert into public.scan_attempts (user_id) values (p_user_id);
    -- Idempotent: a redelivered capture reuses its key and is charged once.
    insert into public.scan_ledger (user_id, delta, reason, ref_id)
    values (p_user_id, -1, 'scan_used', p_capture_id)
    on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing;
    get diagnostics v_charged = row_count;
    -- Only a charge that actually landed moves the counter. A redelivery
    -- inserted nothing, so decrementing here would report a balance one lower
    -- than the ledger holds.
    if v_charged = 1 and v_remaining is not null then
      v_remaining := greatest(0, v_remaining - 1);
    end if;
  end if;

  return query select v_allowed, v_reason, v_remaining, v_paywall, v_deprioritized;
end;
$$;

revoke all on function public.can_scan(uuid, uuid) from public;
grant execute on function public.can_scan(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
