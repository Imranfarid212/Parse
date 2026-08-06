-- RLS policies constrain rows, while table grants permit the authenticated
-- role to exercise those policies from the security-invoker mutation RPC.
grant select, insert on table public.receipt_mutations to authenticated;
