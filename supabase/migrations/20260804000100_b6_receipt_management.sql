-- B6 Receipt management: one RLS-safe read predicate, ranked search, atomic
-- edits, reversible soft deletion, and retention purge support.

create or replace view public.active_receipts
with (security_invoker = true)
as
select r.*
from public.receipts r
where r.deleted_at is null;

grant select on public.active_receipts to authenticated, service_role;

-- Receipt rows are mutable but never hard-deletable by the client. Line-item
-- replacement remains allowed through the owner-scoped child policy.
drop policy if exists "receipts owner all" on public.receipts;
drop policy if exists "receipts owner select" on public.receipts;
drop policy if exists "receipts owner insert" on public.receipts;
drop policy if exists "receipts owner update" on public.receipts;
create policy "receipts owner select" on public.receipts for select using (user_id = auth.uid());
create policy "receipts owner insert" on public.receipts for insert with check (user_id = auth.uid());
create policy "receipts owner update" on public.receipts for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.search_receipts(
  p_text text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_category_ids int[] default null,
  p_amount_min numeric default null,
  p_amount_max numeric default null,
  p_amount_currency text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  capture_id uuid,
  status public.receipt_status,
  merchant text,
  txn_date date,
  currency text,
  total numeric,
  category_id int,
  category_name text,
  image_path text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  line_items jsonb,
  search_rank real
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_query tsquery;
  v_text text := nullif(btrim(p_text), '');
begin
  if p_amount_min is not null and p_amount_min < 0 then
    raise exception using errcode = '22023', message = 'amount_min must be nonnegative';
  end if;
  if p_amount_max is not null and p_amount_max < 0 then
    raise exception using errcode = '22023', message = 'amount_max must be nonnegative';
  end if;
  if p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max then
    raise exception using errcode = '22023', message = 'amount_min must be less than or equal to amount_max';
  end if;
  if (p_amount_min is not null or p_amount_max is not null) and p_amount_currency is null then
    raise exception using errcode = '22023', message = 'amount_currency is required with amount filters';
  end if;
  if p_amount_currency is not null and p_amount_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'amount_currency must be an ISO 4217 code';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'date_from must be before or equal to date_to';
  end if;

  v_query := case when v_text is null then null else websearch_to_tsquery('simple', v_text) end;

  return query
  select
    r.id,
    r.capture_id,
    r.status,
    r.merchant,
    r.txn_date,
    r.currency,
    r.total,
    r.category_id,
    c.name,
    r.image_path,
    r.notes,
    r.created_at,
    r.updated_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object('id', ri.id, 'name', ri.name, 'qty', ri.qty, 'amount', ri.amount)
        order by ri.id
      ) filter (where ri.id is not null),
      '[]'::jsonb
    ),
    case when v_query is null then 0::real else ts_rank_cd(r.search_text, v_query, 32) end
  from public.active_receipts r
  left join public.categories c on c.id = r.category_id
  left join public.receipt_items ri on ri.receipt_id = r.id
  where r.user_id = auth.uid()
    and r.status in ('needs_review', 'confirmed', 'failed', 'processing')
    and (v_query is null or r.search_text @@ v_query)
    and (p_date_from is null or r.txn_date >= p_date_from)
    and (p_date_to is null or r.txn_date <= p_date_to)
    and (p_category_ids is null or cardinality(p_category_ids) = 0 or r.category_id = any(p_category_ids))
    and (p_amount_currency is null or r.currency = p_amount_currency)
    and (p_amount_min is null or r.total >= p_amount_min)
    and (p_amount_max is null or r.total <= p_amount_max)
  group by r.id, r.capture_id, r.status, r.merchant, r.txn_date, r.currency,
    r.total, r.category_id, c.name, r.image_path, r.notes, r.created_at,
    r.updated_at, r.search_text
  order by
    case when v_query is null then 0::real else ts_rank_cd(r.search_text, v_query, 32) end desc,
    r.txn_date desc nulls last,
    r.created_at desc,
    r.id
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.search_receipts(text, date, date, int[], numeric, numeric, text, int, int)
  to authenticated, service_role;

create or replace function public.update_receipt_with_items(
  p_receipt_id uuid,
  p_merchant text,
  p_txn_date date,
  p_currency text,
  p_total numeric,
  p_category_id int,
  p_notes text,
  p_items jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated_at timestamptz;
begin
  if nullif(btrim(p_merchant), '') is null or char_length(p_merchant) > 160 then
    raise exception using errcode = '22023', message = 'merchant must contain 1 to 160 characters';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'currency must be an ISO 4217 code';
  end if;
  if p_total is null or p_total < 0 or p_total > 9999999999.99 then
    raise exception using errcode = '22023', message = 'total is outside the supported range';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception using errcode = '22023', message = 'notes must not exceed 2000 characters';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 250 then
    raise exception using errcode = '22023', message = 'items must be an array containing at most 250 rows';
  end if;
  if not exists (
    select 1 from public.categories c
    where c.id = p_category_id
      and (c.is_system or exists (
        select 1 from public.user_categories uc
        where uc.user_id = auth.uid() and uc.category_id = c.id
      ))
  ) then
    raise exception using errcode = '22023', message = 'category is not available to this user';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(name text, qty numeric, amount numeric)
    where nullif(btrim(x.name), '') is null or char_length(x.name) > 160
      or x.qty is null or x.qty <= 0 or x.qty > 999999.99
      or x.amount is null or x.amount < 0 or x.amount > 9999999999.99
  ) then
    raise exception using errcode = '22023', message = 'one or more line items are invalid';
  end if;

  update public.receipts
  set merchant = btrim(p_merchant),
      txn_date = p_txn_date,
      currency = p_currency,
      total = p_total,
      category_id = p_category_id,
      notes = nullif(btrim(p_notes), '')
  where id = p_receipt_id
    and user_id = auth.uid()
    and deleted_at is null
    and status in ('needs_review', 'confirmed')
  returning updated_at into v_updated_at;

  if not found then
    raise exception using errcode = 'P0002', message = 'receipt not found or not editable';
  end if;

  delete from public.receipt_items where receipt_id = p_receipt_id;
  insert into public.receipt_items (receipt_id, name, qty, amount)
  select p_receipt_id, btrim(x.name), x.qty, x.amount
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(name text, qty numeric, amount numeric);

  -- Item triggers update the parent once more, so return the final LWW version.
  select r.updated_at into v_updated_at from public.receipts r where r.id = p_receipt_id;
  return v_updated_at;
end;
$$;

grant execute on function public.update_receipt_with_items(uuid, text, date, text, numeric, int, text, jsonb)
  to authenticated;

create or replace function public.soft_delete_receipt(p_receipt_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare v_deleted_at timestamptz;
begin
  update public.receipts
  set deleted_at = now()
  where id = p_receipt_id and user_id = auth.uid() and deleted_at is null
  returning deleted_at into v_deleted_at;
  if not found then
    raise exception using errcode = 'P0002', message = 'receipt not found';
  end if;
  return v_deleted_at;
end;
$$;

create or replace function public.restore_receipt(p_receipt_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare v_updated_at timestamptz;
begin
  update public.receipts
  set deleted_at = null
  where id = p_receipt_id
    and user_id = auth.uid()
    and deleted_at >= now() - interval '30 days'
  returning updated_at into v_updated_at;
  if not found then
    raise exception using errcode = 'P0002', message = 'receipt is not restorable';
  end if;
  return v_updated_at;
end;
$$;

grant execute on function public.soft_delete_receipt(uuid), public.restore_receipt(uuid) to authenticated;

create table if not exists public.receipt_image_purge_queue (
  image_path text primary key,
  receipt_id uuid not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.receipt_image_purge_queue from public, anon, authenticated;
grant select, insert, update, delete on public.receipt_image_purge_queue to service_role;

create or replace function public.purge_soft_deleted_receipts(
  p_before timestamptz default now() - interval '30 days',
  p_limit int default 100,
  p_dry_run boolean default false
)
returns table (receipt_id uuid, image_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_dry_run then
    return query
      select r.id, r.image_path
      from public.receipts r
      where r.deleted_at <= p_before
      order by r.deleted_at, r.id
      limit least(greatest(coalesce(p_limit, 100), 1), 1000);
    return;
  end if;
  return query
    with due as materialized (
      select r.id
      from public.receipts r
      where r.deleted_at <= p_before
      order by r.deleted_at, r.id
      for update skip locked
      limit least(greatest(coalesce(p_limit, 100), 1), 1000)
    ), queued as (
      insert into public.receipt_image_purge_queue (image_path, receipt_id)
      select r.image_path, r.id
      from public.receipts r
      join due on due.id = r.id
      where r.image_path is not null
      on conflict (image_path) do nothing
      returning image_path
    ), removed as (
      delete from public.receipts r
      using due
      where r.id = due.id
      returning r.id, r.image_path
    )
    select removed.id, removed.image_path from removed
    left join queued on queued.image_path = removed.image_path;
end;
$$;

revoke all on function public.purge_soft_deleted_receipts(timestamptz, int, boolean) from public, anon, authenticated;
grant execute on function public.purge_soft_deleted_receipts(timestamptz, int, boolean) to service_role;

-- Existing rows created before the B6 trigger rollout need one backfill.
select public.refresh_receipt_search_text(r.id) from public.receipts r;

-- Realtime reconciliation is scoped by RLS and the client user_id filter.
do $$
begin
  alter publication supabase_realtime add table public.receipts;
exception when duplicate_object then null;
end $$;
