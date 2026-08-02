-- B4 — can_scan(): fail loudly when the lock has nothing to lock.
--
-- The atomicity of the whole function rests on one line:
--
--   perform 1 from public.profiles p where p.id = p_user_id for update;
--
-- profiles is not read here and is never written; its row is purely the mutex
-- that serialises one user's concurrent scans, because the thing actually being
-- protected — the balance — is an aggregate over scan_ledger and so has no row
-- to lock. Rows that do not exist yet cannot be locked, which is why the debit
-- itself cannot serve as the lock.
--
-- The hazard is that PERFORM matching no row locks nothing AND raises nothing.
-- A user without a profiles row would run the entire function unserialised, and
-- two parallel captures could both spend the last scan — silently, with no error
-- anywhere. handle_new_user() creates the row on signup so this should be
-- unreachable, but "should be unreachable" is exactly the condition worth
-- asserting: the cost of being wrong is billing a user twice.
--
-- Also stops a redelivered capture from moving the counter. The debit is
-- idempotent on UNIQUE(user_id, reason, ref_id), so the second delivery inserts
-- nothing — but out_remaining was decremented regardless, reporting a balance
-- one lower than the ledger holds.
--
-- The signature and return type are unchanged, so CREATE OR REPLACE is enough
-- here; the previous migration had to drop and recreate only because renaming
-- outputs changes the return type.

create or replace function public.can_scan(p_user_id uuid, p_capture_id uuid)
returns table (out_allowed boolean, out_reason text, out_remaining int, out_paywall text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plus_product   constant text := 'rf_plus_699_m';
  v_unlim_product  constant text := 'rf_unlimited_1199_m';
  v_plus_cap       constant int  := 500;
  v_burst_per_min  constant int  := 12;
  v_product_id  text;
  v_period      timestamptz;
  v_used        int;
  v_balance     int;
  v_recent      int;
  v_charged     int := 0;
  v_allowed     boolean := false;
  v_reason      text;
  v_remaining   int;
  v_paywall     text;
begin
  -- Serialise this user's concurrent scans. Everything below reads and writes
  -- under this lock, so two parallel captures cannot both spend the last scan.
  -- The lock lives only as long as this function call, so it is never held
  -- across the model call that follows.
  perform 1 from public.profiles p where p.id = p_user_id for update;
  if not found then
    -- Without a row there is no mutex, and every guarantee below is void.
    -- The callers fail closed on a quota error, so raising refuses the scan.
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
    return query select false, 'rate_limited'::text, null::int, 'plus'::text;
    return;
  end if;

  select s.product_id, s.current_period_start
    into v_product_id, v_period
    from public.subscriptions s
   where s.user_id = p_user_id
     and s.status in ('active', 'grace')  -- grace counts as active; expiry flips on the webhook
   order by s.current_period_start desc nulls last
   limit 1;

  if v_product_id = v_unlim_product then
    v_allowed := true; v_reason := 'unlimited'; v_remaining := null; v_paywall := 'unlimited';

  elsif v_product_id = v_plus_product and v_period is not null then
    -- current_period_start is authoritative for the monthly window.
    select count(*) into v_used
      from public.scan_ledger sl
     where sl.user_id = p_user_id and sl.reason = 'scan_used' and sl.created_at >= v_period;
    v_remaining := greatest(0, v_plus_cap - greatest(0, v_used));
    v_paywall := 'unlimited';  -- a capped Plus user is sold Unlimited (D8)
    if v_remaining > 0 then v_allowed := true;  v_reason := 'plus_within_cap';
    else                    v_allowed := false; v_reason := 'plus_cap_hit'; end if;

  else
    select coalesce(sum(sl.delta), 0) into v_balance
      from public.scan_ledger sl where sl.user_id = p_user_id;
    v_paywall := 'plus';
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

  return query select v_allowed, v_reason, v_remaining, v_paywall;
end;
$$;

revoke all on function public.can_scan(uuid, uuid) from public;
grant execute on function public.can_scan(uuid, uuid) to service_role;

-- A replaced function keeps its PostgREST entry, but reloading is free and
-- removes one candidate cause if rpc() ever reports it missing again.
notify pgrst, 'reload schema';
