-- B4 — fix can_scan(): output parameters collided with column names.
--
-- The first cut named its OUT parameters `allowed`, `reason`, `remaining` and
-- `paywall`. In PL/pgSQL those are variables in scope for the whole body, so
--
--   insert into public.scan_ledger (user_id, delta, reason, ref_id)
--     ... on conflict (user_id, reason, ref_id) do nothing
--
-- makes `reason` mean both the ledger column and the output variable. Every
-- scan failed on it, which the function reported as "Quota could not be
-- verified" because the extract path fails closed on a quota error.
--
-- Renamed with an out_ prefix so no output can ever shadow a column, and every
-- column reference inside a query is now table-qualified. The callers read the
-- new names.
--
-- Also reloads the PostgREST schema cache: a function created by a migration is
-- not visible to rpc() until the cache refreshes, which would produce the same
-- symptom for a different reason.

-- Renaming outputs changes the return type, which CREATE OR REPLACE refuses.
drop function if exists public.can_scan(uuid, uuid);

create function public.can_scan(p_user_id uuid, p_capture_id uuid)
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
  v_allowed     boolean := false;
  v_reason      text;
  v_remaining   int;
  v_paywall     text;
begin
  -- Serialise this user's concurrent scans. Everything below reads and writes
  -- under this lock, so two parallel captures cannot both spend the last scan.
  perform 1 from public.profiles p where p.id = p_user_id for update;

  -- Keep the burst window small without needing a cron.
  delete from public.scan_attempts sa
   where sa.user_id = p_user_id and sa.created_at < now() - interval '10 minutes';

  select count(*) into v_recent
    from public.scan_attempts sa
   where sa.user_id = p_user_id and sa.created_at > now() - interval '1 minute';

  -- Counts every attempt we allowed, including ones later refunded for not
  -- being a receipt: a rejected image still costs a model call.
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
    if v_remaining is not null then v_remaining := greatest(0, v_remaining - 1); end if;
  end if;

  return query select v_allowed, v_reason, v_remaining, v_paywall;
end;
$$;

create or replace function public.refund_scan(p_user_id uuid, p_capture_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.scan_ledger (user_id, delta, reason, ref_id)
  values (p_user_id, 1, 'refund', p_capture_id)
  on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing;
$$;

revoke all on function public.can_scan(uuid, uuid) from public;
revoke all on function public.refund_scan(uuid, uuid) from public;
grant execute on function public.can_scan(uuid, uuid) to service_role;
grant execute on function public.refund_scan(uuid, uuid) to service_role;

-- A function created by a migration is invisible to rpc() until this runs.
notify pgrst, 'reload schema';
