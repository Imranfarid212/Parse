alter table public.receipt_capture_metrics
  add column if not exists ocr_image_resize_ms int,
  add column if not exists ocr_input_width int,
  add column if not exists ocr_input_height int,
  add column if not exists ocr_timeout_ms int,
  add column if not exists local_ocr_timed_out int;
