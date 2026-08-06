-- B6 local-first search remains server-authoritative through delta sync. This
-- migration adds the concurrency contract needed before enabling >1 device:
-- monotonic revisions, optimistic conflict detection and idempotent mutations.

alter table public.receipts add column if not exists revision bigint not null default 1;

create or replace function public.bump_receipt_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists receipts_bump_revision on public.receipts;
create trigger receipts_bump_revision
before update of merchant, txn_date, currency, total, category_id, notes, status, deleted_at
on public.receipts for each row execute function public.bump_receipt_revision();

create table if not exists public.receipt_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  mutation_type text not null check (mutation_type in ('edit', 'delete', 'restore')),
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.receipt_mutations enable row level security;
drop policy if exists receipt_mutations_select_own on public.receipt_mutations;
create policy receipt_mutations_select_own on public.receipt_mutations
for select to authenticated using (user_id = auth.uid());
drop policy if exists receipt_mutations_insert_own on public.receipt_mutations;
create policy receipt_mutations_insert_own on public.receipt_mutations
for insert to authenticated with check (user_id = auth.uid());

create or replace function public.update_receipt_with_items_v2(
  p_operation_id uuid,
  p_expected_revision bigint,
  p_receipt_id uuid,
  p_merchant text,
  p_txn_date date,
  p_currency text,
  p_total numeric,
  p_category_id int,
  p_notes text,
  p_items jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_revision bigint;
begin
  select m.result_revision into v_revision
  from public.receipt_mutations m
  where m.user_id = auth.uid() and m.operation_id = p_operation_id;
  if found then return v_revision; end if;

  select r.revision into v_revision from public.receipts r
  where r.id = p_receipt_id and r.user_id = auth.uid() and r.deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'receipt not found or not editable'; end if;

  -- Recheck after taking the receipt lock; this makes concurrent retries with
  -- the same operation id collapse to one committed mutation.
  select m.result_revision into v_revision
  from public.receipt_mutations m
  where m.user_id = auth.uid() and m.operation_id = p_operation_id;
  if found then return v_revision; end if;

  if p_expected_revision is not null and p_expected_revision <> v_revision then
    raise exception using errcode = '40001', message = 'receipt revision conflict';
  end if;

  perform public.update_receipt_with_items(p_receipt_id, p_merchant, p_txn_date,
    p_currency, p_total, p_category_id, p_notes, p_items);
  select r.revision into v_revision from public.receipts r where r.id = p_receipt_id;
  insert into public.receipt_mutations(user_id, operation_id, receipt_id, mutation_type, result_revision)
  values (auth.uid(), p_operation_id, p_receipt_id, 'edit', v_revision);
  return v_revision;
end;
$$;

grant execute on function public.update_receipt_with_items_v2(uuid, bigint, uuid, text, date, text, numeric, int, text, jsonb)
to authenticated;

create index if not exists receipt_mutations_created_idx
on public.receipt_mutations(created_at);
