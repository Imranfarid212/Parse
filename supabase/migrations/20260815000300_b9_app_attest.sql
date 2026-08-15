-- B9 - durable Apple App Attest enrollment and replay protection.

create table if not exists public.app_attest_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_hash text not null unique check (length(challenge_hash) = 64),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  key_id text not null check (length(key_id) between 32 and 256),
  purpose text not null check (purpose in ('enroll', 'referral_redeem')),
  context jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists app_attest_challenges_subject_created_idx
  on public.app_attest_challenges (user_id, device_id, created_at desc);
create index if not exists app_attest_challenges_expiry_idx
  on public.app_attest_challenges (expires_at)
  where consumed_at is null;

create table if not exists public.app_attest_keys (
  key_id text primary key check (length(key_id) between 32 and 256),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  public_key_pem text not null check (length(public_key_pem) between 100 and 4096),
  receipt_base64 text not null check (length(receipt_base64) between 32 and 32768),
  environment text not null check (environment in ('development', 'production')),
  validation_category int not null check (validation_category between 1 and 10),
  bundle_version text not null check (length(bundle_version) between 1 and 64),
  sign_count bigint not null default 0 check (sign_count >= 0),
  active boolean not null default true,
  attested_at timestamptz not null default now(),
  last_asserted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id, key_id)
);

create index if not exists app_attest_keys_subject_idx
  on public.app_attest_keys (user_id, device_id)
  where active;

alter table public.app_attest_challenges enable row level security;
alter table public.app_attest_keys enable row level security;
revoke all on public.app_attest_challenges from anon, authenticated;
revoke all on public.app_attest_keys from anon, authenticated;
grant select, insert, update, delete on public.app_attest_challenges to service_role;
grant select, insert, update on public.app_attest_keys to service_role;

-- Claims exactly one live challenge. Consuming before cryptographic validation
-- is deliberate: a malformed proof cannot be retried against the same nonce.
create or replace function public.claim_app_attest_challenge(
  p_challenge_hash text,
  p_user_id uuid,
  p_device_id uuid,
  p_key_id text,
  p_purpose text,
  p_context jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_claimed boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.app_attest_challenges
     set consumed_at = now()
   where challenge_hash = p_challenge_hash
     and user_id = p_user_id
     and device_id = p_device_id
     and key_id = p_key_id
     and purpose = p_purpose
     and context = coalesce(p_context, '{}'::jsonb)
     and consumed_at is null
     and expires_at > now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_app_attest_challenge(text, uuid, uuid, text, text, jsonb) from public;
grant execute on function public.claim_app_attest_challenge(text, uuid, uuid, text, text, jsonb) to service_role;

-- Advances the assertion counter with compare-and-swap semantics so two
-- concurrent uses of the same assertion cannot both succeed.
create or replace function public.advance_app_attest_counter(
  p_key_id text,
  p_user_id uuid,
  p_device_id uuid,
  p_expected_count bigint,
  p_next_count bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_advanced boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_next_count <= p_expected_count then return false; end if;

  update public.app_attest_keys
     set sign_count = p_next_count,
         last_asserted_at = now(),
         updated_at = now()
   where key_id = p_key_id
     and user_id = p_user_id
     and device_id = p_device_id
     and active
     and sign_count = p_expected_count
  returning true into v_advanced;

  return coalesce(v_advanced, false);
end;
$$;

revoke all on function public.advance_app_attest_counter(text, uuid, uuid, bigint, bigint) from public;
grant execute on function public.advance_app_attest_counter(text, uuid, uuid, bigint, bigint) to service_role;

-- Bound unconsumed challenge storage without relying on an external cron.
create or replace function public.prune_app_attest_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.app_attest_challenges
   where expires_at < now() - interval '1 day'
      or consumed_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_app_attest_challenges() from public;
grant execute on function public.prune_app_attest_challenges() to service_role;
