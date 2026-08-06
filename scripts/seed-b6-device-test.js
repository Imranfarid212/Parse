/**
 * Creates a disposable, fully-onboarded staging user with the 200-receipt B6
 * fixture set. Refuses production through scripts/lib/staging.js.
 *
 * The generated magic link redirects into the installed app, so device tests
 * never depend on a real mailbox. Credentials are written only under tmp/.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { connectPg, deleteUser, makeAdmin, resolveConfig } = require('./lib/staging');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'tmp', 'b6-device-test-account.json');

async function main() {
  const config = resolveConfig({ needDbUrl: true, needAnonKey: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);
  const email = `b6-device-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  let userId = null;

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { country: 'US', default_currency: 'USD', purpose: 'b6-device-test' },
    });
    if (createError) throw createError;
    userId = created.user.id;

    await pg.query('begin');
    try {
      await pg.query(
        `update public.profiles
            set country = 'US', default_currency = 'USD', onboarding_complete = true
          where id = $1`,
        [userId],
      );
      await pg.query(
        `insert into public.user_categories (user_id, category_id, sort_order)
         select $1, id, id from public.categories
         on conflict (user_id, category_id) do update set sort_order = excluded.sort_order`,
        [userId],
      );
      await pg.query(
        `create temporary table b6_seed_rows on commit drop as
         select n, gen_random_uuid() as receipt_id, gen_random_uuid() as capture_id
         from generate_series(1, 200) as n`,
      );
      await pg.query(
        `insert into public.receipts (
           id, user_id, capture_id, status, confirmed_via, capture_mode, provider,
           merchant, txn_date, currency, total, category_id, notes, created_at, updated_at
         )
         select
           s.receipt_id,
           $1,
           s.capture_id,
           'confirmed',
           'user',
           'default',
           case when s.n % 4 = 0 then 'gemini'::provider else 'grok'::provider end,
           format('B6 Merchant %s', lpad(s.n::text, 3, '0')),
           date '2026-01-01' + ((s.n - 1) % 200),
           case s.n % 3 when 1 then 'USD' when 2 then 'EUR' else 'GBP' end,
           round((9.50 + s.n * 1.25)::numeric, 2),
           ((s.n - 1) % 10) + 1,
           format('B6 audit note cohort-%s searchable-device-fixture', ((s.n - 1) % 8) + 1),
           now() - make_interval(mins => 201 - s.n),
           now() - make_interval(mins => 201 - s.n)
         from b6_seed_rows s`,
        [userId],
      );
      await pg.query(
        `insert into public.receipt_items (receipt_id, name, qty, amount)
         select s.receipt_id, item.name, item.qty, item.amount
         from b6_seed_rows s
         cross join lateral (
           values
             (format('B6 Item %s Alpha', lpad(s.n::text, 3, '0')), 1::numeric, round((s.n * 0.60)::numeric, 2)),
             (format('B6 Item %s Beta', lpad(s.n::text, 3, '0')), 2::numeric, round((s.n * 0.30)::numeric, 2))
         ) as item(name, qty, amount)`,
      );
      await pg.query('commit');
    } catch (error) {
      await pg.query('rollback');
      throw error;
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: 'parse://auth/callback' },
    });
    if (linkError) throw linkError;

    const userClient = createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const { count, error: countError } = await userClient
      .from('receipts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    if (countError) throw countError;
    if (count !== 200) throw new Error(`Expected 200 visible receipts, found ${count}`);

    const searches = [
      ['merchant', { p_text: 'B6 Merchant 042' }, 1],
      ['item', { p_text: 'B6 Item 137 Alpha' }, 1],
      ['note', { p_text: 'cohort-4' }, 25],
      ['USD amount', { p_amount_min: 50, p_amount_max: 100, p_amount_currency: 'USD' }, null],
    ];
    for (const [label, args, expected] of searches) {
      const startedAt = Date.now();
      const { data, error } = await userClient.rpc('search_receipts', {
        p_text: null,
        p_date_from: null,
        p_date_to: null,
        p_category_ids: null,
        p_amount_min: null,
        p_amount_max: null,
        p_amount_currency: null,
        p_limit: 200,
        p_offset: 0,
        ...args,
      });
      if (error) throw error;
      if (expected !== null && data.length !== expected) {
        throw new Error(`${label} search expected ${expected} rows, found ${data.length}`);
      }
      console.log(`[b6:seed] ${label}: ${data.length} rows (${Date.now() - startedAt}ms network round trip)`);
    }

    const { error: ambiguousAmountError } = await userClient.rpc('search_receipts', {
      p_amount_min: 10,
      p_amount_currency: null,
    });
    if (!ambiguousAmountError) throw new Error('Amount filter without currency was not rejected');

    const account = {
      purpose: 'B6 device test only',
      project: 'staging',
      user_id: userId,
      email,
      password,
      action_link: linkData.properties.action_link,
      created_at: new Date().toISOString(),
      receipt_count: count,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(account, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(outputPath, 0o600);
    console.log(`[b6:seed] PASS account=${email} receipts=${count}`);
    console.log(`[b6:seed] credentials=${outputPath}`);
  } catch (error) {
    if (userId) await deleteUser(admin, userId, pg);
    throw error;
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`[b6:seed] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
