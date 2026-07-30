alter table public.receipts
  add column if not exists duplicate_of uuid references public.receipts(id) on delete set null,
  add column if not exists duplicate_match_strength text
    check (duplicate_match_strength is null or duplicate_match_strength in ('weak', 'strong'));

create index if not exists receipts_user_duplicate_of_idx
  on public.receipts(user_id, duplicate_of, created_at desc)
  where deleted_at is null;
