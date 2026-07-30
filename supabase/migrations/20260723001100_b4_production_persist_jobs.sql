create table if not exists public.extraction_persist_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  receipt_id uuid,
  capture_id uuid not null unique,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  attempts int not null default 1,
  payload jsonb not null,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.extraction_persist_jobs enable row level security;

drop policy if exists "persist jobs owner read" on public.extraction_persist_jobs;
create policy "persist jobs owner read" on public.extraction_persist_jobs
  for select using (auth.uid() = user_id);

grant select on public.extraction_persist_jobs to authenticated;
grant select, insert, update on public.extraction_persist_jobs to service_role;
