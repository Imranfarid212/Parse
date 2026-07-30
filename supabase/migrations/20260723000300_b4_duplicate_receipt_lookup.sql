create index if not exists receipts_user_duplicate_lookup_idx
  on public.receipts(user_id, txn_date, currency, total)
  where deleted_at is null and status in ('needs_review', 'confirmed');
