-- B7 Export: durable export jobs, the SQL truth every artifact is built from,
-- and retention for the files those artifacts leave in Storage.
--
-- The job table itself shipped in B1. What it lacked was everything that makes
-- deferred work survive a dead worker: a lease, an attempt count, a retry
-- schedule, and a claim path that two sweepers cannot both win. That is what
-- this migration adds, deliberately mirroring extraction_jobs (B5) so there is
-- one durable-work pattern in the system rather than two.

alter table public.export_jobs
  add column if not exists attempt_count int not null default 0,
  add column if not exists next_retry_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists receipt_count int,
  add column if not exists error text,
  add column if not exists artifacts jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.export_jobs add constraint export_jobs_attempt_count_check check (attempt_count between 0 and 3);
exception when duplicate_object then null;
end $$;

create index if not exists export_jobs_due_idx on public.export_jobs(status, next_retry_at);
create index if not exists export_jobs_user_created_idx on public.export_jobs(user_id, created_at desc);

-- A client may watch its own jobs and nothing else. Every write goes through a
-- service-role RPC below: a user who could UPDATE this table directly could
-- mark a job done and point file_path at an export that was never built.
--
-- The grant matters as much as the policy. export_jobs was created in B1 with a
-- permissive `for all` policy and no table privileges at all, which meant the
-- policy was unreachable — the client could not read its own exports, and would
-- not have been able to when the feature shipped. Verified by running it.
drop policy if exists "export jobs owner all" on public.export_jobs;
drop policy if exists "export jobs owner select" on public.export_jobs;
create policy "export jobs owner select" on public.export_jobs for select using (user_id = auth.uid());

revoke all on public.export_jobs from anon;
grant select on public.export_jobs to authenticated;
grant select, insert, update, delete on public.export_jobs to service_role;

do $$
begin
  alter publication supabase_realtime add table public.export_jobs;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- The rows an export is built from
-- ---------------------------------------------------------------------------
-- Reads through public.active_receipts, the same soft-delete-excluding view the
-- app and search read through (B6). An exported ghost receipt is a trust-killer
-- and the only reliable way to prevent one is to not have a second predicate.
--
-- Filter semantics are identical to search_receipts, including the refusal to
-- compare amounts without a currency (D13). The staging harness proves the two
-- agree by running both over the same filters and diffing the id sets, because
-- a copied predicate that drifts is exactly the bug this comment cannot catch.
create or replace function public.export_receipt_rows(
  p_user_id uuid,
  p_text text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_category_ids int[] default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_amount_currency text default null,
  p_limit int default 1000,
  p_offset int default 0
)
returns table (
  id uuid,
  txn_date date,
  merchant text,
  category_name text,
  currency text,
  total numeric,
  notes text,
  image_path text,
  created_at timestamptz,
  line_items jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query tsquery;
  v_text text := nullif(btrim(p_text), '');
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user id is required';
  end if;
  if p_amount_min is not null and p_amount_min < 0 then
    raise exception using errcode = '22023', message = 'amount_min must be nonnegative';
  end if;
  if p_amount_max is not null and p_amount_max < 0 then
    raise exception using errcode = '22023', message = 'amount_max must be nonnegative';
  end if;
  if p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max then
    raise exception using errcode = '22023', message = 'amount_min must be less than or equal to amount_max';
  end if;
  if (p_amount_min is not null or p_amount_max is not null) and p_amount_currency is null then
    raise exception using errcode = '22023', message = 'amount_currency is required with amount filters';
  end if;
  if p_amount_currency is not null and p_amount_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'amount_currency must be an ISO 4217 code';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'date_from must be before or equal to date_to';
  end if;

  v_query := case when v_text is null then null else websearch_to_tsquery('simple', v_text) end;

  return query
  select
    r.id,
    r.txn_date,
    r.merchant,
    c.name,
    r.currency,
    r.total,
    r.notes,
    r.image_path,
    r.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object('name', ri.name, 'qty', ri.qty, 'amount', ri.amount)
        order by ri.id
      ) filter (where ri.id is not null),
      '[]'::jsonb
    )
  from public.active_receipts r
  left join public.categories c on c.id = r.category_id
  left join public.receipt_items ri on ri.receipt_id = r.id
  where r.user_id = p_user_id
    and r.status in ('needs_review', 'confirmed', 'failed', 'processing')
    and (v_query is null or r.search_text @@ v_query)
    and (p_date_from is null or r.txn_date >= p_date_from)
    and (p_date_to is null or r.txn_date <= p_date_to)
    and (p_category_ids is null or cardinality(p_category_ids) = 0 or r.category_id = any(p_category_ids))
    and (p_amount_currency is null or r.currency = p_amount_currency)
    and (p_amount_min is null or r.total >= p_amount_min)
    and (p_amount_max is null or r.total <= p_amount_max)
  group by r.id, r.txn_date, r.merchant, c.name, r.currency, r.total, r.notes,
    r.image_path, r.created_at
  -- Date order is the contract for the images PDF (T7.3) and the natural
  -- reading order for the other two. Ties break on a stable key so two runs of
  -- the same export produce byte-identical page order.
  order by r.txn_date asc nulls last, r.created_at asc, r.id asc
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.export_receipt_rows(uuid, text, date, date, int[], numeric, numeric, text, int, int)
  from public, anon, authenticated;
grant execute on function public.export_receipt_rows(uuid, text, date, date, int[], numeric, numeric, text, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Job lifecycle
-- ---------------------------------------------------------------------------

/** Caps concurrent work per user, then enqueues, in one statement. */
create or replace function public.enqueue_export_job(
  p_user_id uuid,
  p_filters jsonb,
  p_format export_format,
  p_include_images boolean,
  p_max_in_flight int default 3
)
returns public.export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.export_jobs;
  v_in_flight int;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  -- Locking the profile row makes the count and the insert atomic, the same way
  -- can_scan() does for quota: two taps on Generate cannot both see zero.
  perform 1 from public.profiles where id = p_user_id for update;

  select count(*) into v_in_flight
  from public.export_jobs
  where user_id = p_user_id and status in ('queued', 'running');

  if v_in_flight >= greatest(coalesce(p_max_in_flight, 3), 1) then
    raise exception using errcode = 'PT429', message = 'too many exports already running';
  end if;

  insert into public.export_jobs (user_id, filters, format, include_images, status, next_retry_at)
  values (p_user_id, coalesce(p_filters, '{}'::jsonb), p_format, coalesce(p_include_images, false), 'queued', now())
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.enqueue_export_job(uuid, jsonb, export_format, boolean, int) from public, anon, authenticated;
grant execute on function public.enqueue_export_job(uuid, jsonb, export_format, boolean, int) to service_role;

/**
 * Claims due jobs the way the sweeper claims extraction jobs: SKIP LOCKED, a
 * lease rather than a flag, so a worker that dies mid-build leaves a job that
 * simply becomes claimable again when the lease expires.
 */
create or replace function public.claim_export_jobs(
  p_limit int default 3,
  p_lease_seconds int default 240
)
returns setof public.export_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  return query
  with due as materialized (
    select j.id
    from public.export_jobs j
    where j.status in ('queued', 'running')
      and j.next_retry_at <= now()
      and j.attempt_count < 3
      and (
        j.locked_at is null
        or j.locked_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 240), 30))
      )
    order by j.next_retry_at, j.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 3), 1), 25)
  )
  update public.export_jobs j
  set status = 'running',
      locked_at = now(),
      attempt_count = j.attempt_count + 1
  from due
  where j.id = due.id
  returning j.*;
end;
$$;

revoke all on function public.claim_export_jobs(int, int) from public, anon, authenticated;
grant execute on function public.claim_export_jobs(int, int) to service_role;

/**
 * Claims one named job — what the export function calls before running the work
 * inline. Returns no row when the sweeper already holds the lease, which is how
 * the inline attempt and the sweeper avoid building the same export twice.
 */
create or replace function public.claim_export_job(
  p_job_id uuid,
  p_lease_seconds int default 240
)
returns setof public.export_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  return query
  with due as materialized (
    select j.id
    from public.export_jobs j
    where j.id = p_job_id
      and j.status in ('queued', 'running')
      and j.attempt_count < 3
      and (
        j.locked_at is null
        or j.locked_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 240), 30))
      )
    for update skip locked
  )
  update public.export_jobs j
  set status = 'running',
      locked_at = now(),
      attempt_count = j.attempt_count + 1
  from due
  where j.id = due.id
  returning j.*;
end;
$$;

revoke all on function public.claim_export_job(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_export_job(uuid, int) to service_role;

/** Terminal success: artifacts recorded, link lifetime set, lease released. */
create or replace function public.complete_export_job(
  p_job_id uuid,
  p_artifacts jsonb,
  p_receipt_count int,
  p_expires_at timestamptz
)
returns public.export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.export_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if jsonb_typeof(coalesce(p_artifacts, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'artifacts must be an array';
  end if;

  update public.export_jobs
  set status = 'done',
      artifacts = coalesce(p_artifacts, '[]'::jsonb),
      receipt_count = p_receipt_count,
      -- file_path keeps pointing at the first artifact so the B1 column stays
      -- meaningful for anything reading the table without the artifact list.
      file_path = coalesce(p_artifacts -> 0 ->> 'file_path', file_path),
      expires_at = p_expires_at,
      error = null,
      locked_at = null
  where id = p_job_id
    -- A late worker whose job was already reclaimed and finished must not
    -- overwrite the newer result; done is terminal.
    and status <> 'done'
  returning * into v_job;

  if v_job.id is null then
    select * into v_job from public.export_jobs where id = p_job_id;
  end if;
  return v_job;
end;
$$;

revoke all on function public.complete_export_job(uuid, jsonb, int, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_export_job(uuid, jsonb, int, timestamptz) to service_role;

/** Reschedules with backoff, or gives up at three attempts and tells the user. */
create or replace function public.fail_export_job(
  p_job_id uuid,
  p_error text,
  p_backoff_seconds int default 60
)
returns public.export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.export_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  update public.export_jobs
  set status = case when attempt_count >= 3 then 'failed'::export_job_status else 'queued'::export_job_status end,
      error = left(coalesce(p_error, 'export failed'), 500),
      next_retry_at = now() + make_interval(secs => greatest(coalesce(p_backoff_seconds, 60), 5)),
      locked_at = null
  where id = p_job_id
    and status <> 'done'
  returning * into v_job;

  if v_job.id is null then
    select * into v_job from public.export_jobs where id = p_job_id;
  end if;
  return v_job;
end;
$$;

revoke all on function public.fail_export_job(uuid, text, int) from public, anon, authenticated;
grant execute on function public.fail_export_job(uuid, text, int) to service_role;

/**
 * A user-initiated retry of a job that gave up; attempts start over.
 *
 * Security definer with an explicit ownership test rather than invoker: the
 * client holds no UPDATE privilege on export_jobs and should not gain one just
 * to press "Try again".
 */
create or replace function public.retry_export_job(p_job_id uuid)
returns public.export_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.export_jobs;
begin
  update public.export_jobs
  set status = 'queued',
      attempt_count = 0,
      next_retry_at = now(),
      locked_at = null,
      error = null
  where id = p_job_id
    and user_id = auth.uid()
    and status = 'failed'
  returning * into v_job;

  if v_job.id is null then
    raise exception using errcode = 'P0002', message = 'export job is not retryable';
  end if;
  return v_job;
end;
$$;

grant execute on function public.retry_export_job(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
-- A signed link dies at seven days; without this the object behind it would
-- live in the exports bucket forever. Same two-step as the receipt image purge:
-- the row is only forgotten once Storage has confirmed the delete.
create table if not exists public.export_file_purge_queue (
  file_path text primary key,
  job_id uuid not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.export_file_purge_queue from public, anon, authenticated;
grant select, insert, update, delete on public.export_file_purge_queue to service_role;

drop function if exists public.purge_expired_exports(timestamptz, int, boolean);

-- Outputs carry the out_ prefix for the reason recorded in
-- 20260801000200_b4_can_scan_unambiguous: a PL/pgSQL OUT parameter is a
-- variable in scope for the whole body, so an output called file_path makes
-- `on conflict (file_path)` mean two things and the function fails at runtime.
create or replace function public.purge_expired_exports(
  p_before timestamptz default now(),
  p_limit int default 100,
  p_dry_run boolean default false
)
returns table (out_job_id uuid, out_file_path text)
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
      select j.id, artifact ->> 'file_path'
      from public.export_jobs j
      cross join lateral jsonb_array_elements(j.artifacts) as artifact
      where j.status = 'done' and j.expires_at is not null and j.expires_at <= p_before
      order by j.expires_at, j.id
      limit least(greatest(coalesce(p_limit, 100), 1), 1000);
    return;
  end if;

  return query
  with due as materialized (
    select j.id
    from public.export_jobs j
    where j.status = 'done' and j.expires_at is not null and j.expires_at <= p_before
    order by j.expires_at, j.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  ), queued as (
    insert into public.export_file_purge_queue (file_path, job_id)
    select artifact ->> 'file_path', j.id
    from public.export_jobs j
    join due on due.id = j.id
    cross join lateral jsonb_array_elements(j.artifacts) as artifact
    where nullif(artifact ->> 'file_path', '') is not null
    on conflict (file_path) do nothing
    -- Qualified because this function's OUT parameters are also called
    -- file_path and job_id; an unqualified reference is ambiguous and fails at
    -- runtime, which is how the same mistake broke can_scan in B4.
    returning public.export_file_purge_queue.file_path, public.export_file_purge_queue.job_id
  ), cleared as (
    update public.export_jobs j
    set artifacts = '[]'::jsonb, file_path = null
    from due
    where j.id = due.id
    returning j.id
  )
  select queued.job_id, queued.file_path from queued;
end;
$$;

revoke all on function public.purge_expired_exports(timestamptz, int, boolean) from public, anon, authenticated;
grant execute on function public.purge_expired_exports(timestamptz, int, boolean) to service_role;
