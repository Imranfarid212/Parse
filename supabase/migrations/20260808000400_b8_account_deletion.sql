-- B8 — account deletion and the five-year financial retention (D17/§13.2).
--
-- Deletion is not one action, it is two on different clocks:
--
--   now        the person disappears — receipts, images, exports, categories,
--              devices, subscription, profile, session.
--   now + 5y   the anonymised money disappears — payment_events and
--              commission_ledger, kept in between because tax and accounting
--              obligations do not end when a user taps Delete.
--
-- Between those two moments the account_tombstones row is the only thing that
-- remembers the user existed, and it is load-bearing: apply_rc_event() checks it
-- before touching anything, so a renewal that arrives after deletion parks
-- against the tombstone instead of recreating a profile.
--
-- Everything here runs in one transaction. A half-deleted account — images gone
-- but rows present, or profile gone but subscription live — is worse than either
-- outcome, and is exactly what a sequence of client-side deletes produces when
-- the network drops in the middle.
--
-- Storage objects are NOT deleted here. SQL cannot delete from Storage, so the
-- paths are pushed onto the same purge queues B6 and B7 already use and the
-- sweeper removes the objects, retrying until they are gone. A row is only
-- dequeued once Storage confirms.

-- ---------------------------------------------------------------------------
-- The pseudonym that survives deletion.
-- ---------------------------------------------------------------------------
--
-- Anonymising payment_events by nulling user_id loses the one thing the purge
-- needs five years later: which rows belonged to the deleted account. The first
-- cut matched them by timestamp — "anonymous rows recorded before this tombstone
-- was written" — which is a heuristic, and it stranded rows permanently: an
-- event arriving AFTER deletion sorts outside the range, so it survived the
-- purge, and by then the tombstone was gone and nothing could ever collect it.
--
-- Instead each tombstone carries a random financial_ref, and the financial rows
-- carry it in place of the user id. It identifies the rows as a set without
-- identifying the person: the mapping from financial_ref back to a user never
-- exists anywhere, not even in the tombstone, which holds only the ref. When the
-- tombstone is deleted the set becomes uncollectable — which is fine, because
-- its rows are deleted in the same statement.
alter table public.account_tombstones
  add column if not exists financial_ref uuid not null default gen_random_uuid();

alter table public.payment_events
  add column if not exists subject_ref uuid;

create index if not exists payment_events_subject_ref_idx
  on public.payment_events (subject_ref) where subject_ref is not null;

comment on column public.payment_events.subject_ref is
  'Pseudonym linking anonymised rows to their account_tombstones.financial_ref. Never resolvable to a user.';

create or replace function public.delete_account(
  p_user_id uuid,
  p_retention_years int default 5
)
returns table (
  out_purge_financial_at timestamptz,
  out_receipts_deleted int,
  out_images_queued int,
  out_exports_queued int,
  out_payment_events_anonymized int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purge_at   timestamptz;
  v_ref        uuid;
  v_receipts   int := 0;
  v_images     int := 0;
  v_exports    int := 0;
  v_payments   int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  -- A null here would make every predicate below match nothing and the function
  -- would report a successful deletion of an account it never touched.
  if p_user_id is null then
    raise exception using errcode = '22004', message = 'delete_account: p_user_id is required';
  end if;

  v_purge_at := now() + make_interval(years => greatest(coalesce(p_retention_years, 5), 0));

  -- Idempotent by construction. The edge function makes external calls (Apple
  -- token revocation, RevenueCat unlink) before reaching here, and any of them
  -- can fail and be retried; a second run must be a no-op that still reports the
  -- same tombstone rather than an error.
  insert into public.account_tombstones (user_id, deleted_at, purge_financial_at)
  values (p_user_id, now(), v_purge_at)
  on conflict (user_id) do nothing;

  select t.purge_financial_at, t.financial_ref into v_purge_at, v_ref
    from public.account_tombstones t where t.user_id = p_user_id;

  -- Queue the storage objects BEFORE deleting the rows that name them.
  -- Afterwards there is nothing left to read the paths from, and the objects
  -- would be orphaned in the bucket for ever — a privacy failure that leaves no
  -- trace in the database to detect it by.
  with queued as (
    insert into public.receipt_image_purge_queue (image_path, receipt_id)
    select r.image_path, r.id
      from public.receipts r
     where r.user_id = p_user_id and nullif(r.image_path, '') is not null
    on conflict (image_path) do nothing
    returning 1
  )
  select count(*) into v_images from queued;

  with queued as (
    insert into public.export_file_purge_queue (file_path, job_id)
    select artifact ->> 'file_path', j.id
      from public.export_jobs j
      cross join lateral jsonb_array_elements(j.artifacts) as artifact
     where j.user_id = p_user_id and nullif(artifact ->> 'file_path', '') is not null
    on conflict (file_path) do nothing
    returning 1
  )
  select count(*) into v_exports from queued;

  with removed as (
    delete from public.receipts r where r.user_id = p_user_id returning 1
  )
  select count(*) into v_receipts from removed;

  -- Anonymise rather than delete: these are the financial records held for the
  -- retention window. Detaching user_id is what makes them anonymous; the money
  -- and the store reference stay.
  with anonymized as (
    update public.payment_events pe set user_id = null, subject_ref = v_ref
     where pe.user_id = p_user_id
    returning 1
  )
  select count(*) into v_payments from anonymized;

  -- commission_ledger is already anonymous with respect to the buyer: it
  -- references the payment event and the influencer's code, never the user. It
  -- is retained untouched and purged on the same five-year clock.

  -- extraction_jobs and receipt_items are not listed: both cascade from
  -- receipts, which is deleted above. Deleting them by hand would either
  -- duplicate the cascade or, worse, tempt a global "orphaned rows" predicate
  -- that reaches outside this user's data.
  delete from public.export_jobs      where user_id = p_user_id;
  delete from public.scan_ledger      where user_id = p_user_id;
  delete from public.scan_attempts    where user_id = p_user_id;
  delete from public.user_categories  where user_id = p_user_id;
  delete from public.push_tokens      where user_id = p_user_id;
  delete from public.subscriptions    where user_id = p_user_id;
  delete from public.referrals        where referred_user_id = p_user_id;

  -- An influencer's code outlives them so their historical commissions stay
  -- attributable, but it stops granting anything to new signups.
  update public.referral_codes set active = false, owner_user_id = null
   where owner_user_id = p_user_id;

  -- Cascades clear anything user-scoped this list has missed. The profile is
  -- deleted last so a failure anywhere above rolls the whole thing back with the
  -- account still intact.
  delete from public.profiles where id = p_user_id;

  return query select v_purge_at, v_receipts, v_images, v_exports, v_payments;
end;
$$;

revoke all on function public.delete_account(uuid, int) from public;
grant execute on function public.delete_account(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- The five-year sweep.
-- ---------------------------------------------------------------------------

-- Hard-deletes the anonymised financial rows of accounts whose retention window
-- has closed, then the tombstone itself. Runs from the 30-second sweeper like
-- every other purge; at this cadence the work is almost always zero rows, which
-- is the point — nothing needs to remember to run it once a year.
--
-- p_now is a parameter rather than now() so the gate can prove the five-year
-- boundary without waiting five years, and a dry run can show what WOULD go.
create or replace function public.purge_expired_financial_records(
  p_now timestamptz default now(),
  p_limit int default 100,
  p_dry_run boolean default false
)
returns table (out_user_id uuid, out_payment_events int, out_commissions int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if p_dry_run then
    return query
      select t.user_id, 0, 0
        from public.account_tombstones t
       where t.purge_financial_at <= p_now
       order by t.purge_financial_at, t.user_id
       limit least(greatest(coalesce(p_limit, 100), 1), 1000);
    return;
  end if;

  return query
  with due as materialized (
    select t.user_id, t.financial_ref
      from public.account_tombstones t
     where t.purge_financial_at <= p_now
     order by t.purge_financial_at, t.user_id
     for update skip locked
     limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  ),
  -- Matched by the tombstone's pseudonym, not by user_id (long since detached)
  -- and not by timestamp. That catches late arrivals too: an event delivered
  -- after the account was deleted was stamped with the same ref by
  -- apply_rc_event, so it is collected here rather than stranded.
  -- commission_ledger goes first — it references payment_events.
  killed_commissions as (
    delete from public.commission_ledger cl
     using public.payment_events pe, due
     where cl.payment_event_id = pe.id
       and pe.subject_ref = due.financial_ref
    returning 1
  ),
  killed_payments as (
    delete from public.payment_events pe
     using due
     where pe.subject_ref = due.financial_ref
    returning 1
  ),
  cleared as (
    delete from public.account_tombstones t
     using due
     where t.user_id = due.user_id
    returning t.user_id
  )
  select cleared.user_id,
         (select count(*)::int from killed_payments),
         (select count(*)::int from killed_commissions)
    from cleared;
end;
$$;

revoke all on function public.purge_expired_financial_records(timestamptz, int, boolean) from public;
grant execute on function public.purge_expired_financial_records(timestamptz, int, boolean) to service_role;

grant select, insert, delete on public.account_tombstones to service_role;

notify pgrst, 'reload schema';
