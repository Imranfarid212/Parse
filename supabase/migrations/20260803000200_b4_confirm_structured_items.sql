-- B4.8.4 — a receipt header and its item rows are one confirmation transaction.
create or replace function public.confirm_receipt_with_items(p_user_id uuid, p_receipt_id uuid, p_merchant text, p_txn_date date, p_currency text, p_total numeric, p_category_id int, p_notes text, p_items jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'invalid receipt items' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as i(name text, qty numeric, amount numeric) where nullif(trim(i.name), '') is null or length(trim(i.name)) > 160 or i.qty is null or i.qty <= 0 or i.amount is null or i.amount < 0) then raise exception 'invalid receipt item' using errcode = '22023'; end if;
  update public.receipts set status = 'confirmed', confirmed_via = 'user', merchant = p_merchant, txn_date = p_txn_date, currency = p_currency, total = p_total, category_id = p_category_id, notes = p_notes where id = p_receipt_id and user_id = p_user_id;
  if not found then return false; end if;
  delete from public.receipt_items where receipt_id = p_receipt_id;
  insert into public.receipt_items (receipt_id, name, qty, amount) select p_receipt_id, trim(i.name), i.qty, i.amount from jsonb_to_recordset(p_items) as i(name text, qty numeric, amount numeric);
  return true;
end;
$$;
revoke all on function public.confirm_receipt_with_items(uuid, uuid, text, date, text, numeric, int, text, jsonb) from public;
grant execute on function public.confirm_receipt_with_items(uuid, uuid, text, date, text, numeric, int, text, jsonb) to service_role;
notify pgrst, 'reload schema';
