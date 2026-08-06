-- B7 — an export is rendered in the reader's timezone, so the job carries one.
--
-- The generated timestamp on a statement used to be UTC, labelled UTC. Correct,
-- but not what a person wants to read. The device knows its own zone and the
-- server does not, so the zone travels with the request and is stored on the
-- job: the file may be built minutes later by the sweeper, in a process that has
-- no connection to the user who asked for it.
--
-- It is a rendering detail, not a filter, so it gets its own column rather than
-- being folded into filters jsonb, which only ever describes which receipts to
-- select.

alter table public.export_jobs add column if not exists timezone text;

-- CREATE OR REPLACE cannot add a parameter — it would define an overload, and
-- two candidates make the PostgREST call ambiguous. Replace it outright.
drop function if exists public.enqueue_export_job(uuid, jsonb, export_format, boolean, int);

create or replace function public.enqueue_export_job(
  p_user_id uuid,
  p_filters jsonb,
  p_format export_format,
  p_include_images boolean,
  p_timezone text default null,
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

  insert into public.export_jobs (user_id, filters, format, include_images, timezone, status, next_retry_at)
  values (
    p_user_id,
    coalesce(p_filters, '{}'::jsonb),
    p_format,
    coalesce(p_include_images, false),
    nullif(btrim(coalesce(p_timezone, '')), ''),
    'queued',
    now()
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.enqueue_export_job(uuid, jsonb, export_format, boolean, text, int) from public, anon, authenticated;
grant execute on function public.enqueue_export_job(uuid, jsonb, export_format, boolean, text, int) to service_role;
