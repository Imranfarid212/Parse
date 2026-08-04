-- B5 - durable provider fallback jobs and circuit breaker RPCs.
--
-- The tables were created in B1 from Blueprint v1.1. This migration adds the
-- transactional operations B5 needs so Edge Functions do not hand-roll job
-- claims or split a 202 response from its committed job row.

alter table public.extraction_jobs
  alter column provider_attempted type text,
  alter column last_error type text;

create index if not exists extraction_jobs_reclaim_idx
  on public.extraction_jobs(status, next_retry_at, locked_at)
  where status in ('queued', 'running');

create or replace function public.enqueue_provider_delay_job(
  p_user_id uuid,
  p_capture_id uuid,
  p_capture_mode capture_mode,
  p_extraction_mode text,
  p_image_path text,
  p_image_byte_size int,
  p_acked_at timestamptz,
  p_provider_attempted text,
  p_last_error text,
  p_failure_window_seconds int default 120,
  p_failure_threshold int default 3
)
returns table (out_receipt_id uuid, out_breaker_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid;
  v_state text;
  v_failures int;
  v_now timestamptz := now();
begin
  insert into public.receipts (
    user_id,
    capture_id,
    capture_mode,
    extraction_mode,
    status,
    image_path,
    image_byte_size,
    acked_at
  )
  values (
    p_user_id,
    p_capture_id,
    p_capture_mode,
    p_extraction_mode,
    'processing',
    p_image_path,
    p_image_byte_size,
    p_acked_at
  )
  on conflict (capture_id) do update set
    image_path = coalesce(public.receipts.image_path, excluded.image_path),
    image_byte_size = coalesce(public.receipts.image_byte_size, excluded.image_byte_size),
    acked_at = coalesce(public.receipts.acked_at, excluded.acked_at),
    updated_at = v_now
  returning id into v_receipt_id;

  insert into public.extraction_jobs (
    receipt_id,
    status,
    attempt_count,
    next_retry_at,
    locked_at,
    provider_attempted,
    last_error
  )
  values (
    v_receipt_id,
    'queued',
    0,
    v_now,
    null,
    p_provider_attempted,
    p_last_error
  )
  on conflict (receipt_id) do update set
    status = case
      when public.extraction_jobs.status in ('done', 'dead') then public.extraction_jobs.status
      else 'queued'::job_status
    end,
    next_retry_at = case
      when public.extraction_jobs.status in ('done', 'dead') then public.extraction_jobs.next_retry_at
      else v_now
    end,
    locked_at = case
      when public.extraction_jobs.status in ('done', 'dead') then public.extraction_jobs.locked_at
      else null
    end,
    provider_attempted = excluded.provider_attempted,
    last_error = excluded.last_error,
    updated_at = v_now;

  select ps.state, ps.consecutive_failures
    into v_state, v_failures
    from public.provider_state ps
   where ps.id = 1
   for update;

  if not found then
    insert into public.provider_state (id) values (1);
    v_state := 'closed';
    v_failures := 0;
  end if;

  if v_state = 'open' then
    out_breaker_state := v_state;
  else
    if (select updated_at from public.provider_state where id = 1) >= v_now - make_interval(secs => p_failure_window_seconds) then
      v_failures := v_failures + 1;
    else
      v_failures := 1;
    end if;
    v_state := case when v_failures >= p_failure_threshold then 'open' else 'closed' end;
    update public.provider_state
       set state = v_state,
           consecutive_failures = v_failures,
           opened_at = case when v_state = 'open' then coalesce(opened_at, v_now) else null end,
           updated_at = v_now
     where id = 1;
    out_breaker_state := v_state;
  end if;

  out_receipt_id := v_receipt_id;
  return next;
end;
$$;

create or replace function public.get_provider_state()
returns table (out_state text, out_consecutive_failures int, out_opened_at timestamptz, out_last_probe_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select state, consecutive_failures, opened_at, last_probe_at
    from public.provider_state
   where id = 1;
$$;

create or replace function public.close_provider_breaker_after_probe()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_state
     set state = 'closed',
         consecutive_failures = 0,
         opened_at = null,
         last_probe_at = now(),
         updated_at = now()
   where id = 1;
end;
$$;

create or replace function public.claim_extraction_jobs(
  p_limit int default 5,
  p_lease_seconds int default 120
)
returns table (
  job_id uuid,
  receipt_id uuid,
  user_id uuid,
  capture_id uuid,
  capture_mode capture_mode,
  image_path text,
  image_byte_size int,
  default_currency text,
  attempt_count int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select j.id
      from public.extraction_jobs j
      join public.receipts r on r.id = j.receipt_id
     where j.status in ('queued', 'running')
       and j.next_retry_at <= now()
       and (j.locked_at is null or j.locked_at < now() - make_interval(secs => p_lease_seconds))
       and r.status = 'processing'
     order by j.next_retry_at asc, j.created_at asc
     limit greatest(1, least(p_limit, 25))
     for update of j skip locked
  ),
  claimed as (
    update public.extraction_jobs j
       set status = 'running',
           locked_at = now(),
           attempt_count = least(j.attempt_count + 1, 3),
           updated_at = now()
      from due
     where j.id = due.id
     returning j.id, j.receipt_id, j.attempt_count
  )
  select
    c.id,
    r.id,
    r.user_id,
    r.capture_id,
    r.capture_mode,
    r.image_path,
    r.image_byte_size,
    coalesce(p.default_currency, 'USD') as default_currency,
    c.attempt_count
  from claimed c
  join public.receipts r on r.id = c.receipt_id
  join public.profiles p on p.id = r.user_id;
end;
$$;

create or replace function public.finish_extraction_job(
  p_job_id uuid,
  p_provider_attempted text default 'gemini'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.extraction_jobs
     set status = 'done',
         locked_at = null,
         provider_attempted = p_provider_attempted,
         last_error = null,
         updated_at = now()
   where id = p_job_id
     and status in ('queued', 'running');
end;
$$;

create or replace function public.fail_or_reschedule_extraction_job(
  p_job_id uuid,
  p_provider_attempted text,
  p_last_error text,
  p_backoff_seconds int default 30
)
returns table (out_dead boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  select j.id, j.receipt_id, j.attempt_count, r.user_id, r.capture_id
    into v_job
    from public.extraction_jobs j
    join public.receipts r on r.id = j.receipt_id
   where j.id = p_job_id
   for update of j;

  if not found then
    out_dead := false;
    return next;
    return;
  end if;

  if v_job.attempt_count >= 3 then
    update public.receipts
       set status = 'failed',
           updated_at = now()
     where id = v_job.receipt_id
       and status = 'processing';

    perform public.refund_scan(v_job.user_id, v_job.capture_id);

    update public.extraction_jobs
       set status = 'dead',
           locked_at = null,
           provider_attempted = p_provider_attempted,
           last_error = p_last_error,
           updated_at = now()
     where id = p_job_id;

    out_dead := true;
    return next;
    return;
  end if;

  update public.extraction_jobs
     set status = 'queued',
         locked_at = null,
         next_retry_at = now() + make_interval(secs => greatest(1, p_backoff_seconds)),
         provider_attempted = p_provider_attempted,
         last_error = p_last_error,
         updated_at = now()
   where id = p_job_id;

  out_dead := false;
  return next;
end;
$$;

grant select, insert, update on public.extraction_jobs to service_role;
grant select, insert, update on public.provider_state to service_role;
grant execute on function public.enqueue_provider_delay_job(uuid, uuid, capture_mode, text, text, int, timestamptz, text, text, int, int) to service_role;
grant execute on function public.get_provider_state() to service_role;
grant execute on function public.close_provider_breaker_after_probe() to service_role;
grant execute on function public.claim_extraction_jobs(int, int) to service_role;
grant execute on function public.finish_extraction_job(uuid, text) to service_role;
grant execute on function public.fail_or_reschedule_extraction_job(uuid, text, text, int) to service_role;

notify pgrst, 'reload schema';
