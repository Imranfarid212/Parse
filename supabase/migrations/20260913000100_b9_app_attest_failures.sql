-- B9 - client-side App Attest failures are otherwise unrecoverable.
--
-- attestKeyAsync and generateAssertionAsync run device-to-Apple; the server is
-- never on that path and so never learns why they failed. @expo/app-integrity
-- compounds this by rendering every DCError as the same "undefined reason"
-- string, so the alert the user sees identifies nothing either. Without this
-- table an incident leaves only an unconsumed app_attest_challenges row, which
-- cannot separate a transient Apple outage from a rejected key.
--
-- A table rather than function logs: edge log retention is one day on Free and
-- seven on Pro, and the rows have to outlive the report that asks for them.

create table if not exists public.app_attest_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  -- Nullable: a failure in generateKeyAsync happens before any key exists.
  key_id text check (key_id is null or length(key_id) between 32 and 256),
  stage text not null check (stage in ('attest', 'assert')),
  error_code text check (error_code is null or length(error_code) <= 128),
  error_message text check (error_message is null or length(error_message) <= 500),
  platform text not null check (platform in ('ios', 'android')),
  app_version text check (app_version is null or length(app_version) <= 64),
  created_at timestamptz not null default now()
);

create index if not exists app_attest_failures_subject_created_idx
  on public.app_attest_failures (user_id, device_id, created_at desc);
-- Supports the question this table exists to answer: which DCError, how often.
create index if not exists app_attest_failures_code_created_idx
  on public.app_attest_failures (error_code, created_at desc);

alter table public.app_attest_failures enable row level security;
revoke all on public.app_attest_failures from anon, authenticated;
-- SELECT is granted explicitly. public.user_devices omits this grant and so
-- returns 42501 to the service role, which would make this table unreadable by
-- the one client that needs to read it.
grant select, insert, delete on public.app_attest_failures to service_role;

-- Diagnostics must not grow without bound. Mirrors prune_app_attest_challenges.
create or replace function public.prune_app_attest_failures()
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
  delete from public.app_attest_failures where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_app_attest_failures() from public;
grant execute on function public.prune_app_attest_failures() to service_role;
