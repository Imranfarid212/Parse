-- B8 — the RevenueCat Test Store is a third store.
--
-- RevenueCat's Test Store lets purchases be exercised end to end with no Apple
-- or Google account at all: real SDK calls, real entitlements, real webhooks —
-- delivered with `store: "TEST_STORE"` and `environment: "SANDBOX"`.
--
-- Two things were wrong for it:
--
--   1. `subscription_store` was ('apple', 'google') and NOT NULL. A TEST_STORE
--      event mapped to null, the insert violated the constraint, apply_rc_event
--      raised, the webhook answered 500 — and RevenueCat redelivers on 500, so
--      the failure would have repeated indefinitely while nothing worked.
--   2. Nothing recorded whether money was real. Sandbox renewals fire every few
--      minutes (up to five times per test subscription), so without a marker a
--      week of testing would sit in payment_events looking exactly like revenue.
--
-- `test` is therefore a first-class store value and `environment` is recorded on
-- every event. Any revenue query must exclude them; that is the price of being
-- able to test the money paths without a developer account, and it is much
-- cheaper than the alternative of pretending test purchases came from Apple.

alter type subscription_store add value if not exists 'test';

alter table public.payment_events
  add column if not exists environment text
  check (environment is null or environment in ('SANDBOX', 'PRODUCTION'));

comment on column public.payment_events.environment is
  'RevenueCat''s environment for the transaction. Anything but PRODUCTION must be excluded from revenue reporting.';

create index if not exists payment_events_environment_idx
  on public.payment_events (environment) where environment is distinct from 'PRODUCTION';

notify pgrst, 'reload schema';
