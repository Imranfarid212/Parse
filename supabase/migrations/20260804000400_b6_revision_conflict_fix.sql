-- A missing idempotency-log SELECT assigns NULL to its INTO target in PL/pgSQL.
-- Keep the locked receipt revision in a separate variable so the second log
-- lookup cannot erase the value used by optimistic conflict detection.
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
  v_current_revision bigint;
  v_logged_revision bigint;
begin
  select m.result_revision into v_logged_revision
  from public.receipt_mutations m
  where m.user_id = auth.uid() and m.operation_id = p_operation_id;
  if found then return v_logged_revision; end if;

  select r.revision into v_current_revision from public.receipts r
  where r.id = p_receipt_id and r.user_id = auth.uid() and r.deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'receipt not found or not editable'; end if;

  select m.result_revision into v_logged_revision
  from public.receipt_mutations m
  where m.user_id = auth.uid() and m.operation_id = p_operation_id;
  if found then return v_logged_revision; end if;

  if p_expected_revision is not null and p_expected_revision <> v_current_revision then
    raise exception using errcode = '40001', message = 'receipt revision conflict';
  end if;

  perform public.update_receipt_with_items(p_receipt_id, p_merchant, p_txn_date,
    p_currency, p_total, p_category_id, p_notes, p_items);
  select r.revision into v_current_revision from public.receipts r where r.id = p_receipt_id;
  insert into public.receipt_mutations(user_id, operation_id, receipt_id, mutation_type, result_revision)
  values (auth.uid(), p_operation_id, p_receipt_id, 'edit', v_current_revision);
  return v_current_revision;
end;
$$;
