-- B9 - referrals, fraud evidence and atomic scan grants.

alter table public.referral_codes
  drop constraint if exists referral_codes_policy_check;
alter table public.referral_codes
  add constraint referral_codes_policy_check check (
    (kind = 'user' and commission_rate is null and max_uses = 4
      and (owner_user_id is not null or active = false))
    or
    (kind = 'influencer' and commission_rate = 0.15 and max_uses is null)
  ) not valid;

create table if not exists public.referral_redeem_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_id uuid references public.referral_codes(id) on delete set null,
  device_id uuid not null,
  ip_hash text not null check (length(ip_hash) between 32 and 128),
  attestation_verdict text not null,
  result text not null check (result in ('released', 'blocked', 'already_redeemed', 'invalid_code')),
  fraud_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists referral_attempts_device_created_idx
  on public.referral_redeem_attempts (device_id, created_at desc);
create index if not exists referral_attempts_ip_created_idx
  on public.referral_redeem_attempts (ip_hash, created_at desc);

alter table public.referral_redeem_attempts enable row level security;
revoke all on public.referral_redeem_attempts from anon, authenticated;
grant select, insert on public.referral_redeem_attempts to service_role;

-- Active codes must not be enumerable. The Edge Function validates entered
-- codes with the service role; clients may read only their own share code.
drop policy if exists "referral codes readable active" on public.referral_codes;
drop policy if exists "referral codes owner select" on public.referral_codes;
create policy "referral codes owner select" on public.referral_codes
  for select using (owner_user_id = auth.uid());

create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
begin
  for v_i in 1..40 loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code
      from generate_series(1, 6);
    if not exists (select 1 from public.referral_codes where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'could not allocate referral code' using errcode = '40001';
end;
$$;

create or replace function public.ensure_user_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.role() not in ('service_role', 'postgres') and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select code into v_code
    from public.referral_codes
   where owner_user_id = p_user_id and kind = 'user'
   for update;
  if v_code is not null then return v_code; end if;

  loop
    begin
      v_code := public.generate_referral_code();
      insert into public.referral_codes (code, kind, owner_user_id, max_uses, active)
      values (v_code, 'user', p_user_id, 4, true);
      return v_code;
    exception when unique_violation then
      -- A rare collision or concurrent trigger: re-read before retrying.
      select code into v_code from public.referral_codes
       where owner_user_id = p_user_id and kind = 'user';
      if v_code is not null then return v_code; end if;
    end;
  end loop;
end;
$$;

create unique index if not exists referral_codes_one_user_code_idx
  on public.referral_codes (owner_user_id) where kind = 'user' and owner_user_id is not null;

create or replace function public.deactivate_orphaned_referral_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.owner_user_id is not null and new.owner_user_id is null and new.kind = 'user' then
    new.active := false;
  end if;
  return new;
end;
$$;
drop trigger if exists referral_codes_deactivate_orphan on public.referral_codes;
create trigger referral_codes_deactivate_orphan
before update of owner_user_id on public.referral_codes
for each row execute function public.deactivate_orphaned_referral_code();

create or replace function public.create_user_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_user_referral_code(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_create_referral_code on public.profiles;
create trigger profiles_create_referral_code
after insert on public.profiles
for each row execute function public.create_user_referral_code();

do $$
declare v_user_id uuid;
begin
  for v_user_id in select id from public.profiles loop
    perform public.ensure_user_referral_code(v_user_id);
  end loop;
end;
$$;

create or replace function public.get_referral_summary()
returns table (out_code text, out_rewarded int, out_max_rewards int, out_referred boolean)
language plpgsql
security definer
set search_path = public
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform public.ensure_user_referral_code(v_user_id);
  return query
  select rc.code,
         count(r.id) filter (where r.status = 'released')::int,
         rc.max_uses,
         exists (select 1 from public.referrals own where own.referred_user_id = v_user_id)
    from public.referral_codes rc
    left join public.referrals r on r.code_id = rc.id
   where rc.kind = 'user' and rc.owner_user_id = v_user_id
   group by rc.id;
end;
$$;

revoke all on function public.get_referral_summary() from public;
grant execute on function public.get_referral_summary() to authenticated;

create or replace function public.redeem_referral(
  p_user_id uuid,
  p_code text,
  p_entry_method text,
  p_device_id uuid,
  p_ip_hash text,
  p_attestation_valid boolean,
  p_attestation_verdict text,
  p_fraud_flags jsonb default '{}'::jsonb
)
returns table (out_granted boolean, out_reason text, out_referral_id uuid, out_status referral_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.referral_codes%rowtype;
  v_existing public.referrals%rowtype;
  v_referral_id uuid;
  v_released_count int;
  v_device_accounts int;
  v_ip_accounts int;
  v_hour_user_attempts int;
  v_hour_device_attempts int;
  v_hour_ip_attempts int;
  v_flags jsonb := coalesce(p_fraud_flags, '{}'::jsonb);
  v_blocked boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_entry_method not in ('link', 'code') then
    raise exception 'invalid entry method' using errcode = '22023';
  end if;
  if p_code is null or upper(trim(p_code)) !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'invalid referral code' using errcode = '22023';
  end if;

  -- One account lock serializes a link callback racing a manual code entry.
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile missing' using errcode = '23503'; end if;

  select count(*)::int into v_hour_user_attempts from public.referral_redeem_attempts
   where user_id = p_user_id and created_at >= now() - interval '1 hour';
  select count(*)::int into v_hour_device_attempts from public.referral_redeem_attempts
   where device_id = p_device_id and created_at >= now() - interval '1 hour';
  select count(*)::int into v_hour_ip_attempts from public.referral_redeem_attempts
   where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';
  if v_hour_user_attempts >= 12 or v_hour_device_attempts >= 20 or v_hour_ip_attempts >= 50 then
    v_flags := v_flags || jsonb_build_object('rate_limited', true);
    insert into public.referral_redeem_attempts
      (user_id, device_id, ip_hash, attestation_verdict, result, fraud_flags)
    values (p_user_id, p_device_id, p_ip_hash, p_attestation_verdict, 'blocked', v_flags);
    return query select false, 'rate_limited'::text, null::uuid, null::referral_status;
    return;
  end if;

  select * into v_code from public.referral_codes
   where code = upper(trim(p_code)) and active
   for update;
  if not found then
    insert into public.referral_redeem_attempts
      (user_id, device_id, ip_hash, attestation_verdict, result, fraud_flags)
    values
      (p_user_id, p_device_id, p_ip_hash, p_attestation_verdict, 'invalid_code', v_flags);
    return query select false, 'invalid_code'::text, null::uuid, null::referral_status;
    return;
  end if;

  select * into v_existing from public.referrals where referred_user_id = p_user_id;
  if found then
    insert into public.referral_redeem_attempts
      (user_id, code_id, device_id, ip_hash, attestation_verdict, result, fraud_flags)
    values
      (p_user_id, v_code.id, p_device_id, p_ip_hash, p_attestation_verdict,
       case when v_existing.status = 'released' then 'already_redeemed' else 'blocked' end,
       v_existing.fraud_flags);
    return query select false,
      case when v_existing.status = 'released' then 'already_redeemed' else 'blocked' end,
      v_existing.id, v_existing.status;
    return;
  end if;

  select count(distinct user_id)::int into v_device_accounts
    from public.referral_redeem_attempts
   where device_id = p_device_id and created_at >= now() - interval '24 hours';
  select count(distinct user_id)::int into v_ip_accounts
    from public.referral_redeem_attempts
   where ip_hash = p_ip_hash and created_at >= now() - interval '24 hours';
  select count(*)::int into v_released_count
    from public.referrals where code_id = v_code.id and status = 'released';

  v_flags := v_flags || jsonb_build_object(
    'attestation', p_attestation_verdict,
    'self_referral', coalesce(v_code.owner_user_id = p_user_id, false),
    'device_velocity', v_device_accounts,
    'ip_velocity', v_ip_accounts,
    'cap_reached', v_code.max_uses is not null and v_released_count >= v_code.max_uses
  );
  v_blocked := not p_attestation_valid
    or coalesce(v_code.owner_user_id = p_user_id, false)
    or v_device_accounts >= 2
    or v_ip_accounts >= 5
    or (v_code.max_uses is not null and v_released_count >= v_code.max_uses);

  insert into public.referrals
    (code_id, referred_user_id, entry_method, status, released_at, fraud_flags)
  values
    (v_code.id, p_user_id, p_entry_method,
     (case when v_blocked then 'blocked' else 'released' end)::referral_status,
     case when v_blocked then null else now() end,
     v_flags)
  returning id into v_referral_id;

  if not v_blocked then
    if v_code.kind = 'user' and v_code.owner_user_id is not null then
      insert into public.scan_ledger (user_id, delta, reason, ref_id)
      values (v_code.owner_user_id, 10, 'referral_bonus', v_referral_id)
      on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing;
    end if;
    insert into public.scan_ledger (user_id, delta, reason, ref_id)
    values (p_user_id, 5, 'referred_signup', v_referral_id)
    on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing;
  end if;

  insert into public.referral_redeem_attempts
    (user_id, code_id, device_id, ip_hash, attestation_verdict, result, fraud_flags)
  values
    (p_user_id, v_code.id, p_device_id, p_ip_hash, p_attestation_verdict,
     case when v_blocked then 'blocked' else 'released' end, v_flags);

  return query select not v_blocked,
    case when v_blocked then 'blocked' else 'released' end,
    v_referral_id,
    case when v_blocked then 'blocked'::referral_status else 'released'::referral_status end;
end;
$$;

revoke all on function public.redeem_referral(uuid, text, text, uuid, text, boolean, text, jsonb) from public;
grant execute on function public.redeem_referral(uuid, text, text, uuid, text, boolean, text, jsonb) to service_role;

notify pgrst, 'reload schema';
