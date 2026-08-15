-- B8 — storing the Apple refresh token so the account can be deleted properly.
--
-- Apple requires an app offering Sign in with Apple to revoke the user's tokens
-- when they delete their account. Revocation needs a refresh token; a refresh
-- token only exists if the one-time authorization code was exchanged for one at
-- sign-in. B2 authenticated with the identity token alone and discarded the
-- code, which is enough to sign in and not enough to ever revoke — so the
-- capture is added here, in the phase whose gate asserts revocation happens.
--
-- This table holds a credential, and is written accordingly:
--   * RLS on with NO policies. Not "restricted to the owner" — the owner has no
--     business reading it either. Only the service role reaches it, through the
--     two functions that exchange and revoke.
--   * No grants to authenticated or anon. A missing grant is the enforcement;
--     the empty policy list is the second lock.
--   * Deleted the moment it is used or the account goes away, so the window in
--     which the row exists is the window in which it is needed.

create table if not exists public.apple_auth_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.apple_auth_tokens is
  'Apple SIWA refresh tokens, service-role only. Exists solely so account-delete can revoke them (App Store requirement).';

alter table public.apple_auth_tokens enable row level security;

revoke all on public.apple_auth_tokens from anon, authenticated;
grant select, insert, update, delete on public.apple_auth_tokens to service_role;

-- Upsert helper so the link function never has to read the token back to decide
-- between insert and update — nothing should SELECT this column that does not
-- intend to send it to Apple.
create or replace function public.store_apple_refresh_token(
  p_user_id uuid,
  p_refresh_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_user_id is null or coalesce(p_refresh_token, '') = '' then
    raise exception using errcode = '22004', message = 'user id and refresh token are required';
  end if;

  insert into public.apple_auth_tokens (user_id, refresh_token)
  values (p_user_id, p_refresh_token)
  on conflict (user_id) do update
    set refresh_token = excluded.refresh_token,
        updated_at = now();
end;
$$;

revoke all on function public.store_apple_refresh_token(uuid, text) from public;
grant execute on function public.store_apple_refresh_token(uuid, text) to service_role;

/**
 * Hands the token to the caller and deletes it in the same statement.
 *
 * Read-then-delete would leave the row behind whenever revocation failed
 * mid-way, and a credential that outlives its account is exactly what this table
 * must not produce. Taking it means it is gone: if the Apple call then fails,
 * the account is still deleted and the token is unusable by anyone, which is the
 * end state deletion is meant to reach.
 */
create or replace function public.take_apple_refresh_token(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  delete from public.apple_auth_tokens t
   where t.user_id = p_user_id
  returning t.refresh_token into v_token;

  return v_token;
end;
$$;

revoke all on function public.take_apple_refresh_token(uuid) from public;
grant execute on function public.take_apple_refresh_token(uuid) to service_role;

notify pgrst, 'reload schema';
