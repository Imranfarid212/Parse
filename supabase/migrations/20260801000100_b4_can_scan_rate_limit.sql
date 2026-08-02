-- B4 — can_scan(): one atomic decision per scan.
--
-- Until now the entitlement check was three PostgREST reads in application code
-- and the debit was a separate insert written after the model call, seconds
-- later. Two consequences:
--
--   * Nothing bounded how fast a user could call the endpoint. Every scan is a
--     paid model call, and an Unlimited subscriber has no entitlement ceiling
--     at all, so one account could spend without limit.
--   * Two captures fired in parallel both read the balance before either wrote,
--     so a user with one scan left could get two. UNIQUE(user_id, reason,
--     ref_id) makes a *redelivered* capture idempotent but does nothing for two
--     different receipts.
--
-- Both close the same way: decide and debit inside one transaction, under a row
-- lock on the user. The 12/min burst then costs nothing extra because it counts
-- a table this transaction is already touching.
--
-- The charge moves to decision time, so anything that turns out not to be a
-- billable scan must give it back — see refund_scan() and its callers.

create table if not exists public.scan_attempts (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists scan_attempts_user_time_idx on public.scan_attempts (user_id, created_at desc);

-- Server-side only: no policies, and the service role bypasses RLS.
alter table public.scan_attempts enable row level security;
grant select, insert, delete on public.scan_attempts to service_role;
grant usage, select on sequence public.scan_attempts_id_seq to service_role;

/**
 * Decide whether this user may scan, and charge them if so.
 *
 * Returns one row: (allowed, reason, remaining, paywall). `remaining` already
 * accounts for the scan being charged, and is null for Unlimited.
 *
 * The arithmetic mirrors decideQuota() in packages/contracts/src/quota.ts,
 * which remains the client's advisory copy. The constants below are pinned
 * against that file by the B4 gate — if you change one, change both.
 */
create or replace function public.can_scan(p_user_id uuid, p_capture_id uuid)
returns table (allowed boolean, reason text, remaining int, paywall text)
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
  perform 1 from public.profiles where id = p_user_id for update;

  -- Keep the burst window small without needing a cron.
  delete from public.scan_attempts
   where user_id = p_user_id and created_at < now() - interval '10 minutes';

  select count(*) into v_recent
    from public.scan_attempts
   where user_id = p_user_id and created_at > now() - interval '1 minute';

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
      from public.scan_ledger
     where user_id = p_user_id and reason = 'scan_used' and created_at >= v_period;
    v_remaining := greatest(0, v_plus_cap - greatest(0, v_used));
    v_paywall := 'unlimited';  -- a capped Plus user is sold Unlimited (D8)
    if v_remaining > 0 then v_allowed := true;  v_reason := 'plus_within_cap';
    else                    v_allowed := false; v_reason := 'plus_cap_hit'; end if;

  else
    select coalesce(sum(delta), 0) into v_balance
      from public.scan_ledger where user_id = p_user_id;
    v_paywall := 'plus';
    if v_balance > 0 then v_allowed := true;  v_reason := 'free_balance';    v_remaining := v_balance;
    else                  v_allowed := false; v_reason := 'free_exhausted';  v_remaining := 0; end if;
  end if;

  if v_allowed then
    insert into public.scan_attempts (user_id) values (p_user_id);
    -- Idempotent: a redelivered capture reuses its key and is charged once.
    insert into public.scan_ledger (user_id, delta, reason, ref_id)
    values (p_user_id, -1, 'scan_used', p_capture_id)
    on conflict (user_id, reason, ref_id) do nothing;
    if v_remaining is not null then v_remaining := greatest(0, v_remaining - 1); end if;
  end if;

  return query select v_allowed, v_reason, v_remaining, v_paywall;
end;
$$;

/**
 * Give back a scan that was charged at decision time but turned out not to be
 * billable — a rejected image, or a failure on our side. A compensating entry
 * rather than a delete, so the ledger stays an audit trail; idempotent on
 * UNIQUE(user_id, reason, ref_id).
 */
create or replace function public.refund_scan(p_user_id uuid, p_capture_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.scan_ledger (user_id, delta, reason, ref_id)
  values (p_user_id, 1, 'refund', p_capture_id)
  on conflict (user_id, reason, ref_id) do nothing;
$$;

revoke all on function public.can_scan(uuid, uuid) from public;
revoke all on function public.refund_scan(uuid, uuid) from public;
grant execute on function public.can_scan(uuid, uuid) to service_role;
grant execute on function public.refund_scan(uuid, uuid) to service_role;
