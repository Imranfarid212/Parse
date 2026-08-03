-- B5 - schedule the durable-job recovery owner and the Grok canary probe.
--
-- Secrets are populated from deployment environment by scripts/configure-b5-schedules.js.
-- The migration keeps the schedules versioned without placing credentials in git.

create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists supabase_vault;

create or replace function public.configure_b5_schedules()
returns table (out_job_name text, out_job_id bigint, out_schedule text)
language plpgsql
security definer
set search_path = public, cron, net, vault
as $fn$
declare
  v_url text;
  v_key text;
  v_job_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'receiptflow_b5_project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'receiptflow_b5_service_role_key';

  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise exception 'B5 scheduler Vault secrets are not configured';
  end if;

  perform cron.unschedule(jobid)
    from cron.job
   where jobname in ('receiptflow-b5-sweeper', 'receiptflow-b5-provider-probe');

  select cron.schedule(
    'receiptflow-b5-sweeper',
    '30 seconds',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'receiptflow_b5_project_url') || '/functions/v1/sweeper',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'receiptflow_b5_service_role_key'),
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'receiptflow_b5_service_role_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      )
    $job$
  ) into v_job_id;
  out_job_name := 'receiptflow-b5-sweeper';
  out_job_id := v_job_id;
  out_schedule := '30 seconds';
  return next;

  select cron.schedule(
    'receiptflow-b5-provider-probe',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'receiptflow_b5_project_url') || '/functions/v1/provider-probe',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'receiptflow_b5_service_role_key'),
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'receiptflow_b5_service_role_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      )
    $job$
  ) into v_job_id;
  out_job_name := 'receiptflow-b5-provider-probe';
  out_job_id := v_job_id;
  out_schedule := '*/15 * * * *';
  return next;
end;
$fn$;

revoke all on function public.configure_b5_schedules() from public;
grant execute on function public.configure_b5_schedules() to service_role;

notify pgrst, 'reload schema';
