const { Client } = require('pg');
const { randomUUID } = require('crypto');

const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) { failures += 1; console.error(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const users = [];
  const influencerCodes = [];

  async function service(sql, params = []) {
    await db.query('set role service_role');
    try { return await db.query(sql, params); } finally { await db.query('reset role'); }
  }
  async function makeUser() {
    const id = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, 'x', now(), now(), now())`,
      [id, `b9-${id}@test.local`],
    );
    users.push(id);
    return id;
  }
  async function codeFor(userId) {
    return (await db.query(`select code from public.referral_codes where owner_user_id = $1 and kind = 'user'`, [userId])).rows[0].code;
  }
  async function redeem(userId, code, options = {}) {
    const { rows } = await service(
      `select * from public.redeem_referral($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, code, options.entryMethod || 'code', options.deviceId || randomUUID(),
       options.ipHash || randomUUID().replaceAll('-', ''), options.attested !== false,
       options.attested === false ? 'failed' : 'play_integrity_meets_device', JSON.stringify(options.flags || {})],
    );
    return rows[0];
  }
  async function credits(userId, reason) {
    return Number((await db.query(`select coalesce(sum(delta),0)::int n from public.scan_ledger where user_id=$1 and reason=$2`, [userId, reason])).rows[0].n);
  }
  async function applyEvent(event) {
    return (await service(
      `select * from public.apply_rc_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [event.id, event.type, event.userId, 'parse_pro_m', 'apple', new Date().toISOString(),
       new Date().toISOString(), null, event.gross, 'USD', '{}', 'PRODUCTION'],
    )).rows[0];
  }

  try {
    console.log('\nT9.1/T9.2 - both attribution paths and atomic grants');
    const referrer = await makeUser();
    const linkFriend = await makeUser();
    const code = await codeFor(referrer);
    check('link release succeeds', (await redeem(linkFriend, code, { entryMethod: 'link' })).out_granted, true);
    check('link records entry_method', (await db.query(`select entry_method from public.referrals where referred_user_id=$1`, [linkFriend])).rows[0].entry_method, 'link');
    check('referrer gets +10', await credits(referrer, 'referral_bonus'), 10);
    check('friend gets +5', await credits(linkFriend, 'referred_signup'), 5);

    const codeFriend = await makeUser();
    check('manual code release succeeds', (await redeem(codeFriend, code)).out_granted, true);
    check('manual code records code method', (await db.query(`select entry_method from public.referrals where referred_user_id=$1`, [codeFriend])).rows[0].entry_method, 'code');

    console.log('\nT9.3/T9.5 - cap, fraud and replay');
    check('replay reports already redeemed', (await redeem(codeFriend, code)).out_reason, 'already_redeemed');
    check('replay adds no friend credits', await credits(codeFriend, 'referred_signup'), 5);
    check('self referral is blocked', (await redeem(referrer, code)).out_status, 'blocked');
    check('self referral gets zero grant', await credits(referrer, 'referred_signup'), 0);

    const failedFriend = await makeUser();
    check('failed attestation is blocked', (await redeem(failedFriend, code, { attested: false })).out_status, 'blocked');
    check('failed attestation grants zero', await credits(failedFriend, 'referred_signup'), 0);

    const invalidFriend = await makeUser();
    check('unknown code is rejected without a referral row', (await redeem(invalidFriend, 'B9BAD2')).out_reason, 'invalid_code');
    check('unknown code attempt is retained for rate limiting', Number((await db.query(
      `select count(*)::int n from public.referral_redeem_attempts where user_id=$1 and result='invalid_code'`, [invalidFriend],
    )).rows[0].n), 1);

    // Two releases already exist; fill positions 3 and 4, then prove the fifth.
    for (let index = 0; index < 2; index += 1) await redeem(await makeUser(), code);
    const fifth = await makeUser();
    check('fifth rewarded referral is blocked', (await redeem(fifth, code)).out_status, 'blocked');
    check('referrer cap is exactly 40 scans', await credits(referrer, 'referral_bonus'), 40);

    console.log('\nT9.4 - recurring influencer commission and refund reversal');
    const influencerCode = 'B9TEST';
    const codeId = randomUUID();
    influencerCodes.push(codeId);
    await db.query(
      `insert into public.referral_codes (id,code,kind,commission_rate,max_uses,active,payout_contact)
       values ($1,$2,'influencer',0.15,null,true,'b9-test')`, [codeId, influencerCode],
    );
    const buyer = await makeUser();
    check('influencer attribution releases', (await redeem(buyer, influencerCode)).out_granted, true);
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: buyer, gross: 6.99 });
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'RENEWAL', userId: buyer, gross: 6.99 });
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'REFUND', userId: buyer, gross: -6.99 });
    const commissions = (await db.query(
      `select commission_amount::float8 amount,status from public.commission_ledger where code_id=$1 order by commission_amount desc`, [codeId],
    )).rows.map((row) => [row.amount, row.status]);
    check('initial + renewal + reversal are 15% of gross', commissions, [[1.05, 'accrued'], [1.05, 'accrued'], [-1.05, 'reversed']]);

    const blockedBuyer = await makeUser();
    await redeem(blockedBuyer, influencerCode, { attested: false });
    await applyEvent({ id: `evt-${randomUUID()}`, type: 'INITIAL_PURCHASE', userId: blockedBuyer, gross: 6.99 });
    check('blocked influencer attribution earns nothing', Number((await db.query(
      `select count(*)::int n from public.commission_ledger cl join public.payment_events pe on pe.id=cl.payment_event_id where pe.user_id=$1`, [blockedBuyer],
    )).rows[0].n), 0);
  } finally {
    if (influencerCodes.length) {
      await db.query(`delete from public.commission_ledger where code_id = any($1::uuid[])`, [influencerCodes]).catch(() => {});
    }
    if (users.length) {
      await db.query(`delete from public.payment_events where user_id = any($1::uuid[])`, [users]).catch(() => {});
    }
    for (const userId of users.reverse()) await db.query(`delete from auth.users where id=$1`, [userId]).catch(() => {});
    for (const codeId of influencerCodes) await db.query(`delete from public.referral_codes where id=$1`, [codeId]).catch(() => {});
    await db.end();
  }
  if (failures) throw new Error(`${failures} B9 database assertion(s) failed`);
  console.log('\n[b9:db] ok - T9.1-T9.5 database invariants verified');
}

main().catch((error) => { console.error(`[b9:db] FAIL ${error.message}`); process.exit(1); });
