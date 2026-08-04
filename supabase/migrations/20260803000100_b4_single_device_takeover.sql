-- B4.8.3 — one active app installation per account.
--
-- This is intentionally a policy table rather than a profiles column. Moving
-- to a multi-device plan later becomes a policy change, not a data migration.

create table if not exists public.user_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create unique index if not exists user_devices_one_active_per_user_idx
  on public.user_devices (user_id)
  where is_active;

alter table public.user_devices enable row level security;

-- No direct client access: claiming and checking must keep their lock and
-- state transition together inside the functions below.
revoke all on public.user_devices from anon, authenticated;

create or replace function public.claim_user_device(p_device_id uuid, p_takeover boolean default false)
returns table (out_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_active_device_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Serialises competing claims for this account. The unique partial index is
  -- a second line of defence if a future caller bypasses this routine.
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile is missing for authenticated user' using errcode = '23503';
  end if;

  select device_id into v_active_device_id
    from public.user_devices
   where user_id = v_user_id and is_active
   for update;

  if v_active_device_id is not null and v_active_device_id <> p_device_id and not p_takeover then
    return query select 'takeover_required'::text;
    return;
  end if;

  if v_active_device_id is not null and v_active_device_id <> p_device_id then
    update public.user_devices
       set is_active = false
     where user_id = v_user_id and is_active;
  end if;

  insert into public.user_devices (user_id, device_id, is_active, last_seen_at)
  values (v_user_id, p_device_id, true, now())
  on conflict (user_id, device_id) do update
    set is_active = true,
        last_seen_at = excluded.last_seen_at;

  return query select 'active'::text;
end;
$$;

create or replace function public.assert_active_device(p_user_id uuid, p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Edge Functions use the service role for this call. Pinning p_user_id to the
  -- row makes the function safe to use after their JWT verification.
  update public.user_devices
     set last_seen_at = now()
   where user_id = p_user_id
     and device_id = p_device_id
     and is_active;
  return found;
end;
$$;

revoke all on function public.claim_user_device(uuid, boolean) from public;
revoke all on function public.assert_active_device(uuid, uuid) from public;
grant execute on function public.claim_user_device(uuid, boolean) to authenticated;
grant execute on function public.assert_active_device(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
