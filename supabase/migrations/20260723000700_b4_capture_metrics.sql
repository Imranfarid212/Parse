create table if not exists public.receipt_capture_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  capture_id uuid not null,
  receipt_id uuid references public.receipts(id) on delete set null,
  capture_mode text not null,
  extraction_mode text not null,
  document_correction_ms int,
  compression_ms int,
  local_file_ms int,
  local_row_ms int,
  local_ocr_ms int,
  backend_extract_ms int,
  total_to_response_ms int,
  total_to_ui_ms int,
  image_backup_ms int,
  metrics_upload_ms int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, capture_id)
);

alter table public.receipt_capture_metrics enable row level security;

drop policy if exists "capture metrics owner read" on public.receipt_capture_metrics;
create policy "capture metrics owner read" on public.receipt_capture_metrics
  for select using (auth.uid() = user_id);

grant select on public.receipt_capture_metrics to authenticated;
grant select, insert, update on public.receipt_capture_metrics to service_role;
