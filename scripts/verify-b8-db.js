/**
 * B8 database gate — T8.2, T8.4 and the database half of T8.5.
 *
 * Runs against the local stack (or whatever SUPABASE_DB_URL points at) and
 * exercises the money paths for real: the quota matrix across both tiers and the
 * period boundary, parallel scans racing for the last one, webhook replay and
 * refund reversal, an event for a deleted user, and a full deletion followed by
 * a clock-mocked five-year purge.
 *
 * Everything runs inside one schema against throwaway users and cleans up after
 * itself, so it is safe to re-run and safe against a stack with other data in it.
 */
const { Client } = require('pg');
const { randomUUID } = require('crypto');

const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const results = [];
let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok   ${label}`);
  }
  results.push({ label, ok });
}

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // Every RPC under test is service-role gated, which is the point: these are
  // the money functions and no other role may reach them.
  const asService = async (sql, params) => {
    await db.query("set local role service_role");
    const result = await db.query(sql, params);
    await db.query('reset role');
    return result;
  };

  const users = [];
  // Declared out here so the cleanup block can unwind them even when the
  // run aborts before they are created.
  let influencerCodeId = null;
  async function makeUser(freeCredits = 0) {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'x', now(), now(), now())`,
      [id, `b8-${id}@test.local`],
    );
    // handle_new_user() may already have created the profile and the signup grant.
    await db.query(
      `insert into public.profiles (id, country, default_currency) values ($1, 'US', 'USD')
       on conflict (id) do nothing`,
      [id],
    );
    await db.query(`delete from public.scan_ledger where user_id = $1`, [id]);
    if (freeCredits > 0) {
      await db.query(
        `insert into public.scan_ledger (user_id, delta, reason, ref_id) values ($1, $2, 'signup', $1)`,
        [id, freeCredits],
      );
    }
    users.push(id);
    return id;
  }

  const canScan = async (userId, captureId = randomUUID()) => {
    const { rows } = await asService('select * from public.can_scan($1, $2)', [userId, captureId]);
    return rows[0];
  };

  const applyEvent = async (event) => {
    const { rows } = await asService(
      `select * from public.apply_rc_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        event.id,
        event.type,
        event.userId,
        event.productId ?? null,
        event.store ?? 'apple',
        event.occurredAt ?? new Date().toISOString(),
        event.periodStart ?? null,
        event.periodEnd ?? null,
        event.gross ?? null,
        event.currency ?? 'USD',
        JSON.stringify(event.raw ?? {}),
        event.environment ?? 'PRODUCTION',
      ],
    );
    return rows[0];
  };

  try {
    // ---------------------------------------------------------------- T8.2
    console.log('\nT8.2 — can_scan matrix from current_period_start');

    const free = await makeUser(2);
    check('free with 2 credits allows and reports 1 left', await canScan(free), {
      out_allowed: true, out_reason: 'free_balance', out_remaining: 1, out_paywall: 'pro', out_deprioritized: false,
    });
    await canScan(free);
    check('free exhausted refuses and sells Pro', await canScan(free), {
      out_allowed: false, out_reason: 'free_exhausted', out_remaining: 0, out_paywall: 'pro', out_deprioritized: false,
    });

    // Pro at the cap boundary. The ledger is backdated inside the period so the
    // count is real rather than simulated by patching a counter.
    const pro = await makeUser(0);
    const periodStart = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: pro, productId: 'parse_pro_m', periodStart, gross: 6.99 });

    const cap = (await db.query(`select monthly_scan_cap from public.products where id = 'parse_pro_m'`)).rows[0].monthly_scan_cap;
    // 199 used -> 1 left, the last one allowed, then refused.
    for (let i = 0; i < cap - 1; i += 1) {
      await db.query(
        `insert into public.scan_ledger (user_id, delta, reason, ref_id, created_at) values ($1, -1, 'scan_used', $2, $3)`,
        [pro, randomUUID(), new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()],
      );
    }
    check(`Pro with ${cap - 1} used allows the last scan`, (await canScan(pro)).out_reason, 'pro_within_cap');
    check('Pro at the cap refuses and sells Max', await canScan(pro), {
      out_allowed: false, out_reason: 'pro_cap_hit', out_remaining: 0, out_paywall: 'max', out_deprioritized: false,
    });

    // A renewal moves the window; the same ledger rows now fall outside it.
    await applyEvent({
      id: `evt-${randomUUID()}`, type: 'RENEWAL', userId: pro, productId: 'parse_pro_m',
      periodStart: new Date().toISOString(), gross: 6.99,
    });
    check('renewal resets the allowance', (await canScan(pro)).out_reason, 'pro_within_cap');

    // Usage before the renewal must not count against the new period. Asserted
    // as the invariant (remaining == cap - used-in-window) rather than an
    // absolute: the ledger's created_at comes from the database clock and the
    // period start from this process's, and a fraction of a second of drift
    // between them would otherwise flip the count by one at random.
    const afterRenewal = await canScan(pro);
    const usedInWindow = await db.query(
      `select count(*)::int as n from public.scan_ledger sl
        join public.subscriptions s on s.user_id = sl.user_id
       where sl.user_id = $1 and sl.reason = 'scan_used' and sl.created_at >= s.current_period_start`,
      [pro],
    );
    check('remaining equals the cap minus usage inside the new window',
      afterRenewal.out_remaining, cap - usedInWindow.rows[0].n);
    check('pre-renewal usage does not count against the new period',
      usedInWindow.rows[0].n < cap - 1, true);

    const max = await makeUser(0);
    await applyEvent({
      id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: max, productId: 'parse_max_m',
      periodStart: new Date().toISOString(), gross: 10.99,
    });
    check('Max is uncapped', await canScan(max), {
      out_allowed: true, out_reason: 'max_unlimited', out_remaining: null, out_paywall: 'max', out_deprioritized: false,
    });

    // Fair use deprioritises without refusing (D8).
    const threshold = (await db.query(`select fair_use_threshold from public.products where id = 'parse_max_m'`)).rows[0].fair_use_threshold;
    await db.query(
      `insert into public.scan_ledger (user_id, delta, reason, ref_id)
       select $1, -1, 'scan_used', gen_random_uuid() from generate_series(1, $2)`,
      [max, threshold],
    );
    const deprioritized = await canScan(max);
    check('past fair use, Max is deprioritized but still allowed', [deprioritized.out_allowed, deprioritized.out_deprioritized], [true, true]);

    // grace counts as active.
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'BILLING_ISSUE', userId: max, productId: 'parse_max_m' });
    const graceRow = (await db.query(`select status from public.subscriptions where user_id = $1`, [max])).rows[0];
    check('billing issue moves to grace', graceRow.status, 'grace');
    check('grace still scans', (await canScan(max)).out_allowed, true);

    // 10 parallel scans on a 1-credit account must spend exactly one.
    const racer = await makeUser(1);
    const parallel = await Promise.all(
      Array.from({ length: 10 }, () => canScan(racer, randomUUID()).catch(() => ({ out_allowed: false }))),
    );
    check('10 parallel scans on 1 credit allow exactly one', parallel.filter((row) => row.out_allowed).length, 1);

    // The same capture id redelivered is charged once.
    const replayUser = await makeUser(5);
    const captureId = randomUUID();
    await canScan(replayUser, captureId);
    await canScan(replayUser, captureId);
    const charges = await db.query(
      `select count(*)::int as n from public.scan_ledger where user_id = $1 and reason = 'scan_used'`,
      [replayUser],
    );
    check('a redelivered capture is charged once', charges.rows[0].n, 1);

    // ---------------------------------------------------------------- T8.4
    console.log('\nT8.4 — webhook replay, refund reversal, tombstoned events');

    const buyer = await makeUser(0);
    const eventId = `evt-${randomUUID()}`;
    check('first delivery applies', (await applyEvent({ id: eventId, type: 'INITIAL_PURCHASE', userId: buyer, productId: 'parse_pro_m', periodStart: new Date().toISOString(), gross: 6.99 })).out_applied, true);
    check('replay is refused as duplicate', (await applyEvent({ id: eventId, type: 'INITIAL_PURCHASE', userId: buyer, productId: 'parse_pro_m', periodStart: new Date().toISOString(), gross: 6.99 })).out_applied, false);
    const eventRows = await db.query(`select count(*)::int as n from public.payment_events where rc_event_id = $1`, [eventId]);
    check('the replay inserted no second payment row', eventRows.rows[0].n, 1);

    // Influencer commission: 15% accrued, reversed on refund.
    const influencer = await makeUser(0);
    const codeId = randomUUID();
    influencerCodeId = codeId;
    // Generated per run from the code alphabet (no 0/O/1/I). A fixed literal
    // survives an aborted run and makes every later run fail on the unique
    // index rather than on anything this gate is actually testing.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const influencerCode = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    await db.query(
      `insert into public.referral_codes (id, code, kind, owner_user_id, commission_rate, active)
       values ($1, $2, 'influencer', $3, 0.15, true)`,
      [codeId, influencerCode, influencer],
    );
    const referred = await makeUser(0);
    await db.query(
      `insert into public.referrals (code_id, referred_user_id, entry_method, status) values ($1, $2, 'code', 'released')`,
      [codeId, referred],
    );
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: referred, productId: 'parse_pro_m', periodStart: new Date().toISOString(), gross: 6.99 });
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'REFUND', userId: referred, productId: 'parse_pro_m', gross: -6.99 });
    const commissions = await db.query(
      `select cl.commission_amount, cl.status from public.commission_ledger cl
        join public.payment_events pe on pe.id = cl.payment_event_id
       where pe.user_id = $1 order by cl.commission_amount desc`,
      [referred],
    );
    check('one accrual and one reversal at 15%', commissions.rows.map((r) => [Number(r.commission_amount), r.status]), [[1.05, 'accrued'], [-1.05, 'reversed']]);

    const refundedStatus = (await db.query(`select status from public.subscriptions where user_id = $1`, [referred])).rows[0].status;
    check('a refund expires the subscription', refundedStatus, 'expired');

    // --- Test Store: the path that works with no Apple/Google account -------
    const tester = await makeUser(0);
    const testPurchase = await applyEvent({
      id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: tester, productId: 'parse_pro_m',
      store: 'test', environment: 'SANDBOX', periodStart: new Date().toISOString(), gross: 9.99,
    });
    check('a Test Store purchase applies', testPurchase.out_applied, true);
    const testSub = (await db.query(
      `select store::text as store, status from public.subscriptions where user_id = $1`, [tester],
    )).rows[0];
    check('it is recorded against its own store, not folded into apple', testSub, { store: 'test', status: 'active' });
    check('and it grants the tier for real', (await canScan(tester)).out_reason, 'pro_within_cap');
    const testEnv = (await db.query(
      `select environment from public.payment_events where user_id = $1`, [tester],
    )).rows[0];
    check('the event is marked SANDBOX so revenue queries can exclude it', testEnv.environment, 'SANDBOX');

    // Sandbox money must not pay anybody: Test Store subscriptions renew every
    // few minutes, so an afternoon of testing would otherwise owe an influencer
    // commission on dozens of purchases that never happened.
    const sandboxReferred = await makeUser(0);
    await db.query(
      `insert into public.referrals (code_id, referred_user_id, entry_method, status) values ($1, $2, 'code', 'released')`,
      [influencerCodeId, sandboxReferred],
    );
    await applyEvent({
      id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: sandboxReferred, productId: 'parse_pro_m',
      store: 'test', environment: 'SANDBOX', periodStart: new Date().toISOString(), gross: 9.99,
    });
    const sandboxCommissions = await db.query(
      `select count(*)::int as n from public.commission_ledger cl
        join public.payment_events pe on pe.id = cl.payment_event_id
       where pe.user_id = $1`, [sandboxReferred],
    );
    check('sandbox purchases accrue no commission', sandboxCommissions.rows[0].n, 0);

    // ---------------------------------------------------------------- T8.5
    console.log('\nT8.5 — deletion, tombstone, retention');

    const leaver = await makeUser(0);
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: leaver, productId: 'parse_pro_m', periodStart: new Date().toISOString(), gross: 6.99 });
    const receiptId = randomUUID();
    await db.query(
      `insert into public.receipts (id, user_id, capture_id, status, capture_mode, image_path, currency)
       values ($1, $2, $3, 'confirmed', 'default', $4, 'USD')`,
      [receiptId, leaver, randomUUID(), `receipts/${leaver}/${receiptId}.jpg`],
    );

    const deletion = (await asService('select * from public.delete_account($1, $2)', [leaver, 5])).rows[0];
    check('deletion queued the receipt image for storage purge', Number(deletion.out_images_queued), 1);
    check('deletion anonymized the payment event', Number(deletion.out_payment_events_anonymized), 1);
    const purgeAt = new Date(deletion.out_purge_financial_at);
    const yearsOut = (purgeAt - Date.now()) / (365.25 * 24 * 3600 * 1000);
    check('retention window is ~5 years', yearsOut > 4.9 && yearsOut < 5.1, true);

    const leftovers = await db.query(
      `select (select count(*)::int from public.profiles where id = $1) as profiles,
              (select count(*)::int from public.receipts where user_id = $1) as receipts,
              (select count(*)::int from public.subscriptions where user_id = $1) as subs,
              (select count(*)::int from public.payment_events where user_id = $1) as attributed`,
      [leaver],
    );
    check('no user rows survive', leftovers.rows[0], { profiles: 0, receipts: 0, subs: 0, attributed: 0 });

    // A late renewal must not resurrect the account.
    const late = await applyEvent({ id: `evt-${randomUUID()}`, type: 'RENEWAL', userId: leaver, productId: 'parse_pro_m', periodStart: new Date().toISOString(), gross: 6.99 });
    check('a post-deletion event parks against the tombstone', [late.out_applied, late.out_reason], [false, 'tombstoned']);
    const resurrected = await db.query(
      `select (select count(*)::int from public.profiles where id = $1) as profiles,
              (select count(*)::int from public.subscriptions where user_id = $1) as subs`,
      [leaver],
    );
    check('nothing was recreated', resurrected.rows[0], { profiles: 0, subs: 0 });

    // Not yet due.
    const early = await asService('select * from public.purge_expired_financial_records($1, 100, false)', [new Date().toISOString()]);
    check('the purge does not fire before the window closes', early.rows.length, 0);

    // Clock-mocked past the boundary. Both the original and the late event go.
    const purged = await asService(
      'select * from public.purge_expired_financial_records($1, 100, false)',
      [new Date(Date.now() + 5.2 * 365.25 * 24 * 3600 * 1000).toISOString()],
    );
    check('the five-year purge collects the tombstone', purged.rows.length >= 1, true);
    const financialLeft = await db.query(
      `select (select count(*)::int from public.payment_events where subject_ref is not null) as orphans,
              (select count(*)::int from public.account_tombstones where user_id = $1) as tombstones`,
      [leaver],
    );
    check('no financial rows or tombstone survive the purge', financialLeft.rows[0], { orphans: 0, tombstones: 0 });
  } finally {
    for (const id of users) {
      await db.query('delete from public.account_tombstones where user_id = $1', [id]).catch(() => {});
      await db.query('delete from auth.users where id = $1', [id]).catch(() => {});
    }
    // Unwound child-first. commission_ledger and referrals both reference
    // referral_codes without a cascade, and payment_events survives a profile
    // deletion by design (it is only anonymised), so each has to be named.
    await db.query(`delete from public.commission_ledger where code_id = $1`, [influencerCodeId]).catch(() => {});
    await db.query(`delete from public.referrals where code_id = $1`, [influencerCodeId]).catch(() => {});
    await db.query(`delete from public.referral_codes where id = $1`, [influencerCodeId]).catch(() => {});
    await db.query(`delete from public.payment_events where rc_event_id like 'evt-%'`).catch(() => {});
    await db.end();
  }

  console.log(`\n[b8:db] ${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[b8:db] failed', error);
  process.exit(1);
});
