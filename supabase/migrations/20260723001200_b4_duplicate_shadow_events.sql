create table if not exists public.duplicate_shadow_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  capture_id uuid not null,
  receipt_id uuid references public.receipts(id) on delete cascade,
  matched_receipt_id uuid references public.receipts(id) on delete set null,
  match_rule text not null,
  match_strength text not null,
  action text not null default 'shadow_logged',
  merchant text,
  merchant_key text,
  matched_merchant text,
  matched_merchant_key text,
  txn_date date,
  currency text,
  total_minor_units bigint,
  total numeric,
  matched_total numeric,
  created_at timestamptz not null default now(),
  unique (user_id, capture_id, matched_receipt_id, match_rule)
);

create index if not exists duplicate_shadow_events_user_created_idx
  on public.duplicate_shadow_events(user_id, created_at desc);

alter table public.duplicate_shadow_events enable row level security;

drop policy if exists "duplicate shadow events owner read" on public.duplicate_shadow_events;
create policy "duplicate shadow events owner read" on public.duplicate_shadow_events
  for select using (auth.uid() = user_id);

grant select on public.duplicate_shadow_events to authenticated;
grant select, insert, update on public.duplicate_shadow_events to service_role;
