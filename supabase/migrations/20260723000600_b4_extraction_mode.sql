alter table public.receipts
  add column if not exists extraction_mode text not null default 'precise'
    check (extraction_mode in ('balanced', 'precise'));

create index if not exists receipts_user_extraction_mode_idx on public.receipts(user_id, extraction_mode, created_at desc);
