-- Say in SQL what the hosting has been doing for us.
--
-- These seven tables are written only by Edge Functions holding the service
-- role. No migration ever enabled row level security on them; on Supabase they
-- have it anyway, because the platform installs an event trigger (`ensure_rls`,
-- calling `public.rls_auto_enable()`) that enables RLS on every new table in
-- `public`. Nothing in this repository does it, so a local `supabase db reset`
-- or a self-hosted instance brings all seven up with RLS off.
--
-- That is not an open door today. This schema grants DML deliberately — anon
-- and authenticated hold only REFERENCES/TRIGGER/TRUNCATE here, so PostgREST
-- answers 42501 whether RLS is on or not, which a request against the local
-- stack confirms. The exposure is latent rather than live: the day someone adds
-- `grant select ... to authenticated` for a new feature, RLS off means world
-- readable in that instant, and RLS on means still denied until a policy says
-- otherwise. Two locks, so forgetting one is survivable.
--
-- No policies are added. RLS on with no policy denies everyone but the service
-- role, which is exactly what these tables want.
--
-- A no-op on staging and production, where the trigger already did this.
alter table public.payment_events enable row level security;
alter table public.commission_ledger enable row level security;
alter table public.account_tombstones enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.provider_state enable row level security;
alter table public.receipt_image_purge_queue enable row level security;
alter table public.export_file_purge_queue enable row level security;

notify pgrst, 'reload schema';
