create table if not exists public.receipt_capture_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  capture_id uuid not null,
  receipt_id uuid references public.receipts(id) on delete set null,
  attempt_number int not null,
  transport text not null default 'balanced_text',
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms int,
  status_code int,
  error_message text,
  retry_delay_ms int,
  server_total_ms int,
  server_auth_ms int,
  server_body_ms int,
  server_model_ms int,
  server_normalize_ms int,
  network_gap_ms int,
  created_at timestamptz not null default now(),
  unique (user_id, capture_id, attempt_number)
);

alter table public.receipt_capture_attempts enable row level security;

drop policy if exists "capture attempts owner read" on public.receipt_capture_attempts;
create policy "capture attempts owner read" on public.receipt_capture_attempts
  for select using (auth.uid() = user_id);

grant select on public.receipt_capture_attempts to authenticated;
grant select, insert, update on public.receipt_capture_attempts to service_role;
