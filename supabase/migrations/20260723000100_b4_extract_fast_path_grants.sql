grant usage on schema public to service_role;

grant select on public.profiles to service_role;
grant select on public.categories to service_role;
grant select on public.user_categories to service_role;

grant select, insert, update on public.receipts to service_role;
grant select, insert, update, delete on public.receipt_items to service_role;
grant select, insert on public.scan_ledger to service_role;
