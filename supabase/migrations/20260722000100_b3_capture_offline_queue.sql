alter table public.receipts
  add column if not exists image_byte_size int,
  add column if not exists acked_at timestamptz;

create index if not exists receipts_user_capture_id_idx on public.receipts(user_id, capture_id);

drop policy if exists "receipt images owner update" on storage.objects;
create policy "receipt images owner update" on storage.objects for update using (
  bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]
) with check (
  bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]
);

grant insert, update, select on public.receipts to authenticated;
