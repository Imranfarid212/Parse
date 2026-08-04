/** Transfers the disposable B6 fixture set to an accessible staging account. */
const fs = require('fs');
const path = require('path');

const { connectPg, deleteUser, makeAdmin, resolveConfig } = require('./lib/staging');

const root = path.resolve(__dirname, '..');
const accountPath = path.join(root, 'tmp', 'b6-device-test-account.json');

async function main() {
  const targetEmail = process.env.B6_DEVICE_TEST_EMAIL?.trim().toLowerCase();
  if (!targetEmail) throw new Error('B6_DEVICE_TEST_EMAIL is required');
  if (!fs.existsSync(accountPath)) throw new Error('Run b6:device:seed first');

  const fixture = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  const sourceUserId = fixture.user_id;
  const config = resolveConfig({ needDbUrl: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);

  try {
    const target = await pg.query(
      `select u.id, p.onboarding_complete
         from auth.users u
         join public.profiles p on p.id = u.id
        where lower(u.email) = $1
        limit 1`,
      [targetEmail],
    );
    if (target.rowCount !== 1) throw new Error('Target staging user was not found');
    const targetUserId = target.rows[0].id;
    if (!target.rows[0].onboarding_complete) throw new Error('Target user has not completed onboarding');
    if (targetUserId === sourceUserId) throw new Error('Target is already the fixture owner');

    const device = await pg.query(
      `select device_id, last_seen_at
         from public.user_devices
        where user_id = $1 and is_active
        order by last_seen_at desc
        limit 1`,
      [targetUserId],
    );
    if (device.rowCount !== 1) throw new Error('Target user has no active device claim');

    const originalCategories = await pg.query(
      'select category_id from public.user_categories where user_id = $1 order by sort_order, category_id',
      [targetUserId],
    );

    await pg.query('begin');
    try {
      const moved = await pg.query(
        'update public.receipts set user_id = $1, updated_at = now() where user_id = $2 returning id, capture_id',
        [targetUserId, sourceUserId],
      );
      if (moved.rowCount !== 200) throw new Error(`Expected to transfer 200 receipts, transferred ${moved.rowCount}`);

      await pg.query(
        `insert into public.user_categories (user_id, category_id, sort_order)
         select $1, id, id from public.categories
         on conflict (user_id, category_id) do nothing`,
        [targetUserId],
      );
      await pg.query('commit');

      fixture.attached_user_id = targetUserId;
      fixture.attached_email = targetEmail;
      fixture.original_category_ids = originalCategories.rows.map((row) => row.category_id);
      fixture.receipt_ids = moved.rows.map((row) => row.id);
      fixture.capture_ids = moved.rows.map((row) => row.capture_id);
      fixture.attached_at = new Date().toISOString();
      delete fixture.password;
      delete fixture.action_link;
      fs.writeFileSync(accountPath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
      fs.chmodSync(accountPath, 0o600);
    } catch (error) {
      await pg.query('rollback');
      throw error;
    }

    await deleteUser(admin, sourceUserId, pg);

    const verified = await pg.query(
      `select count(*)::int as total,
              count(*) filter (where currency = 'USD')::int as usd,
              count(*) filter (where currency = 'EUR')::int as eur,
              count(*) filter (where currency = 'GBP')::int as gbp
         from public.receipts
        where user_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
      [targetUserId, fixture.receipt_ids],
    );
    const counts = verified.rows[0];
    if (counts.total !== 200) throw new Error(`Post-transfer verification found ${counts.total} receipts`);
    console.log(`[b6:attach] PASS receipts=${counts.total} USD=${counts.usd} EUR=${counts.eur} GBP=${counts.gbp}`);
    console.log(`[b6:attach] active_device_last_seen=${new Date(device.rows[0].last_seen_at).toISOString()}`);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(`[b6:attach] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
