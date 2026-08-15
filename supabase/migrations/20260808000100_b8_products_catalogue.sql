-- B8 — the product catalogue becomes data.
--
-- B1 wrote the sellable products into a CHECK constraint on subscriptions:
--
--   check (product_id in ('rf_plus_699_m', 'rf_unlimited_1199_m'))
--
-- That was right when there were two products and their ids never moved. It is
-- wrong now. The Plan screen sells two tiers on two billing terms across two
-- price lists — eight store products — and the quota allowance is a property of
-- the TIER, not of the id. Encoding that in a CHECK means every price
-- experiment is a schema migration, and it gives can_scan() nowhere to read an
-- allowance from except a hardcoded number in its own body.
--
-- So the catalogue becomes a table. can_scan() joins to it, the webhook
-- validates against it, and adding a SKU is an INSERT.
--
-- The ids themselves mirror packages/contracts/src/products.ts exactly. That
-- duplication is deliberate and is asserted by the B8 gate: SQL cannot import
-- TypeScript, so the two are pinned against each other by a test rather than
-- left to agree by luck.

create table if not exists public.products (
  id text primary key,
  tier text not null check (tier in ('pro', 'max')),
  term text not null check (term in ('month', 'year')),
  offering text not null check (offering in ('default', 'promo')),
  -- null = uncapped. The number is the allowance per billing period, counted
  -- from subscriptions.current_period_start (D16), never per calendar month.
  monthly_scan_cap int check (monthly_scan_cap is null or monthly_scan_cap > 0),
  -- Past this many scans in a period an uncapped user is deprioritised, not
  -- refused (D8 fair use). null = no threshold. Kept as a column so no SQL body
  -- carries its own copy of the number.
  fair_use_threshold int check (fair_use_threshold is null or fair_use_threshold > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tier, term, offering)
);

comment on table public.products is
  'Sellable store products. Mirrors packages/contracts/src/products.ts; the B8 gate asserts the two agree.';

insert into public.products (id, tier, term, offering, monthly_scan_cap, fair_use_threshold) values
  ('parse_pro_m',        'pro', 'month', 'default', 200,  null),
  ('parse_pro_y',        'pro', 'year',  'default', 200,  null),
  ('parse_max_m',        'max', 'month', 'default', null, 2000),
  ('parse_max_y',        'max', 'year',  'default', null, 2000),
  ('parse_pro_m_promo',  'pro', 'month', 'promo',   200,  null),
  ('parse_pro_y_promo',  'pro', 'year',  'promo',   200,  null),
  ('parse_max_m_promo',  'max', 'month', 'promo',   null, 2000),
  ('parse_max_y_promo',  'max', 'year',  'promo',   null, 2000)
on conflict (id) do update
  set tier = excluded.tier,
      term = excluded.term,
      offering = excluded.offering,
      monthly_scan_cap = excluded.monthly_scan_cap,
      fair_use_threshold = excluded.fair_use_threshold;

-- Readable by any signed-in user: the Plan screen needs to know what a product
-- grants before buying it, and none of this is secret — it is on the store
-- listing. Nobody but the service role may write it.
alter table public.products enable row level security;
drop policy if exists "products readable" on public.products;
create policy "products readable" on public.products for select using (true);
grant select on public.products to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- subscriptions now references the catalogue.
-- ---------------------------------------------------------------------------

-- Pre-launch there are no real subscribers, but staging carries test rows on
-- the old ids. Map them forward rather than deleting: a test account that was
-- Plus should still be Pro afterwards, or the B4 quota fixtures silently start
-- exercising the free tier instead.
update public.subscriptions set product_id = 'parse_pro_m' where product_id = 'rf_plus_699_m';
update public.subscriptions set product_id = 'parse_max_m' where product_id = 'rf_unlimited_1199_m';

alter table public.subscriptions drop constraint if exists subscriptions_product_id_check;

-- Anything still unmapped is a row this build cannot reason about — an id from
-- a future SKU or a hand-edited test row. Fail the migration loudly rather than
-- adding a constraint that quietly refuses to validate.
do $$
declare v_orphans int;
begin
  select count(*) into v_orphans
    from public.subscriptions s
    left join public.products p on p.id = s.product_id
   where p.id is null;
  if v_orphans > 0 then
    raise exception 'B8: % subscription row(s) reference a product not in the catalogue', v_orphans;
  end if;
end $$;

alter table public.subscriptions
  drop constraint if exists subscriptions_product_id_fkey;
alter table public.subscriptions
  add constraint subscriptions_product_id_fkey
  foreign key (product_id) references public.products(id);

-- Which price list the purchase came from. Not used for entitlement — it is
-- there so "how many people took the promo" is answerable without joining
-- against a product id convention.
alter table public.subscriptions add column if not exists offering text;

update public.subscriptions s
   set offering = p.offering
  from public.products p
 where p.id = s.product_id and s.offering is null;

-- One live subscription per user. Without this the webhook's upsert has no
-- conflict target, and a renewal arriving twice could leave two active rows
-- whose current_period_start disagree — which is the quota window.
create unique index if not exists subscriptions_user_id_key on public.subscriptions (user_id);

create index if not exists subscriptions_status_period_idx
  on public.subscriptions (status, current_period_start desc);

notify pgrst, 'reload schema';
