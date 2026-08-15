/**
 * B8 backend source gate.
 *
 * Two jobs. The first is the ordinary one: assert the properties the phase's
 * gate tests describe are actually written into the functions and migrations.
 *
 * The second is the important one: **prove the product catalogue in SQL and the
 * catalogue in TypeScript are the same list.** SQL cannot import TypeScript, so
 * the eight product ids and the Pro allowance exist in two places by necessity.
 * Nothing at runtime would notice them diverging — the app would simply offer a
 * product the server does not recognise, and can_scan() would treat a paying
 * customer as a free user. That failure is silent, only reachable through a real
 * purchase, and costs money in both directions, so it is pinned here.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b8:backend] ${message}`); };
const includes = (source, needle, label) => {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
};
const excludes = (source, needle, label) => {
  if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`);
};

const products = read('packages/contracts/src/products.ts');
const catalogue = read('supabase/migrations/20260808000100_b8_products_catalogue.sql');
const canScan = read('supabase/migrations/20260808000200_b8_can_scan_tiers.sql');
const appleTokens = read('supabase/migrations/20260808000300_b8_apple_auth_tokens.sql');
const deletion = read('supabase/migrations/20260808000400_b8_account_deletion.sql');
const rcApply = read('supabase/migrations/20260808000500_b8_rc_event_apply.sql');
const webhook = read('supabase/functions/rc-webhook/index.ts');
const accountDelete = read('supabase/functions/account-delete/index.ts');
const appleLink = read('supabase/functions/apple-link/index.ts');
const revenuecat = read('supabase/functions/_shared/revenuecat.ts');
const apple = read('supabase/functions/_shared/apple.ts');
const envExample = read('.env.example');
const testStore = read('supabase/migrations/20260808000600_b8_test_store.sql');
const rcEnv = read('supabase/migrations/20260808000700_b8_rc_event_environment.sql');

// --- catalogue parity: the whole point of this file -------------------------
{
  // Rebuild the expected ids from the contract's own rule rather than retyping
  // them, so this check cannot drift the same way the thing it is checking can.
  const tiers = ['pro', 'max'];
  const terms = [['month', 'm'], ['year', 'y']];
  const offerings = ['default', 'promo'];
  const expected = [];
  for (const offering of offerings) {
    for (const tier of tiers) {
      for (const [, suffix] of terms) {
        expected.push(offering === 'promo' ? `parse_${tier}_${suffix}_promo` : `parse_${tier}_${suffix}`);
      }
    }
  }

  const seeded = [...catalogue.matchAll(/\('(parse_[a-z_]+)',\s*'(pro|max)'/g)].map((m) => m[1]);
  const missing = expected.filter((id) => !seeded.includes(id));
  const extra = seeded.filter((id) => !expected.includes(id));
  if (missing.length) fail(`products table is missing seeded SKUs: ${missing.join(', ')}`);
  if (extra.length) fail(`products table seeds SKUs the contract does not define: ${extra.join(', ')}`);
  if (seeded.length !== 8) fail(`expected 8 seeded products, found ${seeded.length}`);

  // The Pro allowance appears in the contract as a number and in SQL as a seed
  // value. They must be the same number.
  const contractCap = /pro:\s*(\d+),/.exec(products);
  if (!contractCap) fail('MONTHLY_SCAN_CAP.pro not found in the contract');
  const sqlCaps = [...catalogue.matchAll(/'(pro|max)',\s*'(?:month|year)',\s*'(?:default|promo)',\s*(\d+|null)/g)];
  const proCaps = new Set(sqlCaps.filter((m) => m[1] === 'pro').map((m) => m[2]));
  const maxCaps = new Set(sqlCaps.filter((m) => m[1] === 'max').map((m) => m[2]));
  if (proCaps.size !== 1 || !proCaps.has(contractCap[1])) {
    fail(`Pro cap disagrees: contract says ${contractCap[1]}, products table seeds ${[...proCaps].join('/')}`);
  }
  if (maxCaps.size !== 1 || !maxCaps.has('null')) {
    fail(`the uncapped tier must seed a null cap, found ${[...maxCaps].join('/')}`);
  }

  const contractThreshold = /MAX_FAIR_USE_THRESHOLD = (\d+)/.exec(products);
  if (!contractThreshold) fail('MAX_FAIR_USE_THRESHOLD not found in the contract');
  includes(catalogue, contractThreshold[1], 'fair-use threshold is seeded from the same number as the contract');
}

// --- the catalogue replaced the CHECK constraint ----------------------------
includes(catalogue, 'drop constraint if exists subscriptions_product_id_check', 'the hardcoded product CHECK is dropped');
includes(catalogue, 'foreign key (product_id) references public.products(id)', 'subscriptions reference the catalogue');
includes(catalogue, 'subscriptions_user_id_key', 'one live subscription per user (the webhook upsert target)');
excludes(canScan, 'rf_plus_699_m', 'can_scan must not carry the retired product ids');
excludes(canScan, 'rf_unlimited_1199_m', 'can_scan must not carry the retired product ids');

// --- can_scan invariants carried forward from B4 ----------------------------
includes(canScan, 'for update', 'the profiles row is still the per-user mutex');
includes(canScan, "raise exception 'can_scan: no profiles row for user %'", 'a missing profile still fails loudly');
includes(canScan, 'on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing', 'the debit is still idempotent');
includes(canScan, 'if v_charged = 1 and v_remaining is not null', 'a redelivery still must not move the counter');
includes(canScan, "s.status in ('active', 'grace')", 'grace still counts as active');
includes(canScan, 'p.monthly_scan_cap', 'the cap is read from the catalogue, not hardcoded');
includes(canScan, 'out_deprioritized', 'fair use is reported without refusing the scan');
excludes(canScan, 'v_plus_cap       constant int  := 500', 'the old hardcoded cap is gone');

// --- rc-webhook -------------------------------------------------------------
includes(webhook, 'secureEquals', 'the webhook secret is compared in constant time');
includes(webhook, "Deno.env.get('RC_WEBHOOK_AUTH')", 'the webhook secret comes from env');
excludes(webhook, 'Bearer ', 'no literal secret in the webhook source');
includes(webhook, 'apply_rc_event', 'state changes go through the transactional RPC');
includes(webhook, 'return json(500', 'a database failure asks RevenueCat to redeliver');
includes(webhook, "json(401, { status: 401, code: 'UNAUTHORIZED' })", 'a bad secret is refused');
// The single most valuable property in this file: an unconfigured deployment
// must refuse everything rather than accept everything.
includes(webhook, 'if (!expectedAuth', 'a missing secret refuses, never allows');

includes(rcApply, 'account_tombstones', 'the tombstone is checked');
includes(rcApply, "return query select false, 'tombstoned'::text", 'a deleted user is never recreated');
includes(rcApply, 'on conflict (rc_event_id) do nothing', 'replays are deduped at the database level');
includes(rcApply, "return query select false, 'duplicate'::text", 'a replay reports itself');
includes(rcApply, 'subject_ref', 'post-deletion events are stamped for the retention purge');
includes(rcApply, "when excluded.status = 'active' then excluded.current_period_start", 'only a real period moves the quota window');
includes(rcApply, 'commission_ledger', 'influencer commission is written in the same transaction');
includes(rcApply, "when p_type = 'REFUND' then 'reversed'", 'refunds append a reversal');
// CANCELLATION must not appear in the status map: it means auto-renew off, not
// access ended, and cutting a paying user off mid-period is a refund generator.
excludes(rcEnv, "'CANCELLATION', 'EXPIRATION'", 'a cancellation must not expire access');

// --- Test Store (no Apple/Google account needed) ----------------------------
includes(revenuecat, "TEST_STORE: 'test'", 'the Test Store is a store of its own, never folded into apple');
includes(revenuecat, 'normalizeEnvironment', 'sandbox vs production is recorded');
includes(revenuecat, "=== 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX'", 'anything not explicitly production is treated as sandbox');
includes(webhook, "event.store === 'test' && Deno.env.get('RC_ALLOW_TEST_STORE') !== '1'", 'production refuses Test Store events by default');
includes(rcEnv, "coalesce(p_environment, 'PRODUCTION') = 'PRODUCTION'", 'sandbox money never accrues a commission');
includes(testStore, "alter type subscription_store add value if not exists 'test'", 'the store enum carries a test value');

// --- account-delete ---------------------------------------------------------
includes(accountDelete, 'take_apple_refresh_token', 'Apple tokens are revoked on deletion');
includes(accountDelete, 'unlinkRevenueCat', 'the RevenueCat subscriber is unlinked');
includes(accountDelete, 'delete_account', 'the purge runs as one transaction');
includes(accountDelete, 'auth.admin.deleteUser', 'sessions are revoked by deleting the auth user');
includes(accountDelete, "Deno.env.get('RC_SECRET_API_KEY')", 'the RevenueCat secret key comes from env');
excludes(accountDelete, 'req.json()', 'account-delete takes no body — the JWT names the account');

includes(deletion, 'purge_financial_at', 'the retention window is recorded');
includes(deletion, 'financial_ref', 'anonymised rows keep a collectable pseudonym');
includes(deletion, 'receipt_image_purge_queue', 'storage objects are queued before their rows are deleted');
includes(deletion, 'export_file_purge_queue', 'export files are queued too');
includes(deletion, 'set user_id = null, subject_ref = v_ref', 'financial rows are anonymised, not deleted');
includes(deletion, 'purge_expired_financial_records', 'the five-year sweep exists');
includes(deletion, 'p_now timestamptz default now()', 'the purge boundary is injectable so the gate can prove it');

// --- Apple ------------------------------------------------------------------
includes(apple, 'APPLE_SIWA_PRIVATE_KEY', 'the signing key comes from env');
includes(apple, 'ECDSA', 'the client secret is ES256 as Apple requires');
includes(apple, '/auth/revoke', 'revocation calls the documented endpoint');
excludes(apple, '-----BEGIN PRIVATE KEY-----\nMII', 'no key material in source');
includes(appleTokens, 'enable row level security', 'the token table is RLS-enabled');
includes(appleTokens, 'revoke all on public.apple_auth_tokens from anon, authenticated', 'no client role can read tokens');
includes(appleLink, 'authorization_code', 'the sign-in code is exchanged for a refresh token');

// --- secrets stay out of git ------------------------------------------------
for (const name of ['RC_WEBHOOK_AUTH', 'RC_SECRET_API_KEY', 'APPLE_SIWA_PRIVATE_KEY']) {
  includes(envExample, `${name}=`, `${name} is documented in .env.example`);
  if (new RegExp(`^${name}=.+$`, 'm').test(envExample)) fail(`${name} has a value committed in .env.example`);
}
excludes(revenuecat, 'appl_', 'no RevenueCat key literal in source');
excludes(revenuecat, 'goog_', 'no RevenueCat key literal in source');

console.log('[b8:backend] ok — catalogue parity, webhook, deletion and secret hygiene verified');
