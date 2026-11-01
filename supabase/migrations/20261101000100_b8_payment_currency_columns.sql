-- Every amount gets its own currency.
--
-- `payment_events` shipped with one amount slot — gross_amount + currency — but
-- RevenueCat sends two amounts in two different currencies:
--
--   price                        the sale converted into the project's
--                                REPORTING currency (a RevenueCat project
--                                setting, USD here)
--   price_in_purchased_currency  what the customer was actually charged
--   currency                     the currency of price_in_purchased_currency,
--                                and of nothing else
--
-- Two facts, one slot, so the webhook had to choose — and it chose the amount
-- from one pair with the label from the other. The first non-US sale
-- (6.99 CAD, 2026-11-01) landed as `5.00 CAD`: a correct USD figure wearing a
-- CAD label, a price nobody was ever charged. It went unnoticed because every
-- fixture had price == price_in_purchased_currency and currency 'USD', which is
-- the one shape where mixing the two is invisible.
--
-- So: gross_amount/currency now mean what the customer paid — the figure that
-- matches their receipt, a refund request and a chargeback dispute — and the
-- normalized figure moves into columns of its own.
alter table public.payment_events
  -- 4 decimal places, not 2. The reporting figure is an FX conversion and
  -- arrives with that precision (5.001); numeric(12,2) silently rounded it to
  -- 5.00, and a rounding error repeated over every sale is a reconciliation
  -- problem nobody can explain later.
  add column if not exists reporting_amount   numeric(12,4),
  -- Not in the webhook payload. RevenueCat's v1 delivery names the PURCHASE
  -- currency only; the reporting currency exists as a dashboard setting, so the
  -- webhook supplies it from RC_REPORTING_CURRENCY. Stored rather than assumed,
  -- because a project that changes that setting would otherwise leave every
  -- historical row claiming a currency it was never denominated in.
  add column if not exists reporting_currency text,
  -- In VAT-inclusive storefronts the displayed price includes tax that the
  -- store remits, so gross_amount alone cannot answer "what did we earn". Kept
  -- because it costs one column and the alternative is re-deriving it from the
  -- raw payload per row, per query.
  add column if not exists tax_percentage     numeric(5,4);

comment on column public.payment_events.gross_amount is
  'What the customer was charged, in `currency` (RevenueCat price_in_purchased_currency).';
comment on column public.payment_events.reporting_amount is
  'The same sale in `reporting_currency` (RevenueCat price). Use this to sum revenue across storefronts.';

-- The ledger had no currency column at all, which is the reason the webhook
-- reached for the normalized figure in the first place: sum(commission_amount)
-- over a CAD accrual and a USD accrual is a meaningless number, and that sum is
-- what an influencer gets paid from. Naming the currency is what makes storing
-- the purchased amount in payment_events safe.
alter table public.commission_ledger
  add column if not exists currency text;

comment on column public.commission_ledger.currency is
  'Currency of commission_amount. Accruals are denominated in the reporting currency so payouts stay summable.';

notify pgrst, 'reload schema';
