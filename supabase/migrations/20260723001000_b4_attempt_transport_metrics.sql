alter table public.receipt_capture_attempts
  add column if not exists attempt_timeout_ms int,
  add column if not exists timed_out int,
  add column if not exists transport_error int,
  add column if not exists ms_since_warmup int,
  add column if not exists app_state text;
