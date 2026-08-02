/**
 * B4 — can_scan() and refund_scan(), verified against a live database.
 *
 * Every other verify-*.js script in this repo reads migration files as text and
 * checks that the right words are on the page. That catches drift between the
 * SQL and the app's advisory copy of the same rules, and nothing else: it cannot
 * tell whether the migration was ever applied, or whether the function does what
 * it says. The bug that actually cost a session — output parameters shadowing
 * column names, fixed in 20260801000200 — was invisible on paper and obvious the
 * instant anything ran the function.
 *
 * So this one runs it. It creates a throwaway user, drives it through every
 * entitlement branch, the burst limit, and the parallel race the row lock exists
 * for, then deletes the user. Nothing is left behind and no model is ever called,
 * so it is free to run as often as you like.
 *
 * Two channels, on purpose:
 *
 *   * can_scan() and refund_scan() are called over PostgREST with the service
 *     role key — exactly how the edge functions reach them. Going in the front
 *     door also exercises the schema cache, which was the other candidate cause
 *     of "Quota could not be verified" and is invisible over plain SQL.
 *   * Seeding and assertions go over a direct Postgres connection, because
 *     service_role deliberately holds least privilege here: select on profiles
 *     and subscriptions, nothing more. Widening those grants so the tests could
 *     write would permanently enlarge what a leaked key can do, in production,
 *     to serve a test. Not worth it.
 *
 * Needs both, in .env.staging (gitignored):
 *
 *   SUPABASE_SERVICE_ROLE_KEY=...   supabase projects api-keys --reveal --project-ref <ref>
 *   SUPABASE_DB_URL=postgresql://...
 *
 * Run: node scripts/verify-b4-db.js
 */
const { randomUUID } = require('crypto');
const { resolveConfig, makeAdmin, connectPg, projectRef, withUser } = require('./lib/staging');

const TAG = '[b4:db]';

/** How many parallel captures the race test fires at a balance of one. */
const RACE_WIDTH = 6;
/** Must match v_burst_per_min in the can_scan migration. */
const BURST_PER_MIN = 12;
/** Must match v_plus_cap. */
const PLUS_CAP = 500;
const PRODUCT_PLUS = 'rf_plus_699_m';
const PRODUCT_UNLIMITED = 'rf_unlimited_1199_m';

// -------------------------------------------------------------- test plumbing

const results = [];
let currentChecks = 0;

function assert(condition, message) {
  currentChecks += 1;
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

async function test(name, fn) {
  currentChecks = 0;
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, checks: currentChecks });
    console.log(`${TAG} PASS ${name} (${currentChecks} checks, ${Date.now() - startedAt}ms)`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`${TAG} FAIL ${name}\n        ${error.message}`);
  }
}

// ------------------------------------------------------------ database access

function makeDb(admin, pg) {
  const one = async (text, params) => (await pg.query(text, params)).rows[0];

  return {
    // --- the front door: how the edge functions actually reach these ---------

    /** Returns { row, error } — callers that expect a refusal need the error. */
    async canScan(userId, captureId) {
      const { data, error } = await admin.rpc('can_scan', { p_user_id: userId, p_capture_id: captureId });
      if (error) return { row: null, error };
      const row = Array.isArray(data) ? data[0] : data;
      return { row: row ?? null, error: null };
    },

    async refund(userId, captureId) {
      const { error } = await admin.rpc('refund_scan', { p_user_id: userId, p_capture_id: captureId });
      if (error) throw new Error(`refund_scan: ${error.message}`);
    },

    // --- setup and assertions, over SQL -------------------------------------

    /** Wipes the ledger (including the signup grant) and sets an exact balance. */
    async setBalance(userId, balance) {
      await pg.query('delete from public.scan_ledger where user_id = $1', [userId]);
      if (balance !== 0) {
        await pg.query(
          `insert into public.scan_ledger (user_id, delta, reason, ref_id)
           values ($1, $2, 'admin', gen_random_uuid())`,
          [userId, balance],
        );
      }
    },

    /** Written server-side so the Plus cap test is one round trip, not 500. */
    async seedUsedScans(userId, count) {
      await pg.query(
        `insert into public.scan_ledger (user_id, delta, reason, ref_id)
         select $1, -1, 'scan_used', gen_random_uuid() from generate_series(1, $2)`,
        [userId, count],
      );
    },

    async clearAttempts(userId) {
      await pg.query('delete from public.scan_attempts where user_id = $1', [userId]);
    },

    async countAttempts(userId) {
      const row = await one('select count(*)::int as n from public.scan_attempts where user_id = $1', [userId]);
      return row.n;
    },

    async setSubscription(userId, productId, status = 'active') {
      await pg.query('delete from public.subscriptions where user_id = $1', [userId]);
      await pg.query(
        `insert into public.subscriptions (user_id, store, product_id, status, current_period_start)
         values ($1, 'apple', $2, $3::subscription_status, now() - interval '1 day')`,
        [userId, productId, status],
      );
    },

    async clearSubscription(userId) {
      await pg.query('delete from public.subscriptions where user_id = $1', [userId]);
    },

    async balance(userId) {
      const row = await one(
        'select coalesce(sum(delta), 0)::int as n from public.scan_ledger where user_id = $1',
        [userId],
      );
      return row.n;
    },

    async countByReason(userId, reason, refId = null) {
      const row = await one(
        `select count(*)::int as n from public.scan_ledger
          where user_id = $1 and reason = $2::ledger_reason
            and ($3::uuid is null or ref_id = $3::uuid)`,
        [userId, reason, refId],
      );
      return row.n;
    },

    async deleteProfile(userId) {
      await pg.query('delete from public.profiles where id = $1', [userId]);
    },
  };
}

// --------------------------------------------------------------------- suites

async function entitlementSuite(db, userId) {
  await test('a free scan is allowed and charged exactly once', async () => {
    await db.clearAttempts(userId);
    await db.clearSubscription(userId);
    await db.setBalance(userId, 1);

    const captureId = randomUUID();
    const { row, error } = await db.canScan(userId, captureId);
    assert(!error, `can_scan returned an error: ${error?.message}`);
    assertEqual(row.out_allowed, true, 'out_allowed');
    assertEqual(row.out_reason, 'free_balance', 'out_reason');
    assertEqual(row.out_remaining, 0, 'out_remaining already accounts for this scan');
    assertEqual(row.out_paywall, 'plus', 'out_paywall');
    assertEqual(await db.countByReason(userId, 'scan_used', captureId), 1, 'scan_used rows for this capture');
    assertEqual(await db.balance(userId), 0, 'balance after the charge');
  });

  await test('a redelivered capture is charged once and does not move the counter', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 2);

    const captureId = randomUUID();
    const first = await db.canScan(userId, captureId);
    assertEqual(first.row.out_allowed, true, 'first delivery allowed');
    assertEqual(first.row.out_remaining, 1, 'first delivery remaining');

    const second = await db.canScan(userId, captureId);
    assertEqual(second.row.out_allowed, true, 'redelivery still allowed');
    // The debit is idempotent, so nothing was charged the second time — and the
    // reported balance must not drift below what the ledger actually holds.
    assertEqual(second.row.out_remaining, 1, 'redelivery must not decrement again');
    assertEqual(await db.countByReason(userId, 'scan_used', captureId), 1, 'scan_used rows for this capture');
    assertEqual(await db.balance(userId), 1, 'balance after one real charge');
  });

  await test('an exhausted free user is refused without being charged', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 0);

    const { row } = await db.canScan(userId, randomUUID());
    assertEqual(row.out_allowed, false, 'out_allowed');
    assertEqual(row.out_reason, 'free_exhausted', 'out_reason');
    assertEqual(row.out_remaining, 0, 'out_remaining');
    assertEqual(row.out_paywall, 'plus', 'out_paywall sells Plus');
    assertEqual(await db.countByReason(userId, 'scan_used'), 0, 'no charge for a refused scan');
    // A refusal must not consume burst budget, or hammering would extend the lockout.
    assertEqual(await db.countAttempts(userId), 0, 'refused scans do not record an attempt');
  });

  await test('a refund gives the scan back and is idempotent', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 1);

    const captureId = randomUUID();
    await db.canScan(userId, captureId);
    assertEqual(await db.balance(userId), 0, 'balance after the charge');

    await db.refund(userId, captureId);
    assertEqual(await db.balance(userId), 1, 'balance after the refund');
    assertEqual(await db.countByReason(userId, 'refund', captureId), 1, 'refund rows');

    // A retried background persist must not hand out a second credit.
    await db.refund(userId, captureId);
    assertEqual(await db.countByReason(userId, 'refund', captureId), 1, 'refund rows after a repeat');
    assertEqual(await db.balance(userId), 1, 'balance after a repeated refund');
  });

  await test('Unlimited is allowed with no remaining count', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 0);
    await db.setSubscription(userId, PRODUCT_UNLIMITED);

    const { row } = await db.canScan(userId, randomUUID());
    assertEqual(row.out_allowed, true, 'out_allowed despite a zero free balance');
    assertEqual(row.out_reason, 'unlimited', 'out_reason');
    assertEqual(row.out_remaining, null, 'out_remaining is null for Unlimited');
    assertEqual(row.out_paywall, 'unlimited', 'out_paywall');
  });

  await test('a subscription in grace still counts as active', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 0);
    await db.setSubscription(userId, PRODUCT_UNLIMITED, 'grace');

    const { row } = await db.canScan(userId, randomUUID());
    assertEqual(row.out_allowed, true, 'grace is served');
    assertEqual(row.out_reason, 'unlimited', 'out_reason');
  });

  await test('Plus under the cap is allowed and counts down from the cap', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 0);
    await db.setSubscription(userId, PRODUCT_PLUS);

    const { row } = await db.canScan(userId, randomUUID());
    assertEqual(row.out_allowed, true, 'out_allowed');
    assertEqual(row.out_reason, 'plus_within_cap', 'out_reason');
    assertEqual(row.out_remaining, PLUS_CAP - 1, 'out_remaining counts from the cap, not the ledger balance');
    assertEqual(row.out_paywall, 'unlimited', 'a capped Plus user is sold Unlimited');
  });

  await test('Plus at the cap is refused', async () => {
    await db.clearAttempts(userId);
    await db.setBalance(userId, 0);
    await db.setSubscription(userId, PRODUCT_PLUS);
    await db.seedUsedScans(userId, PLUS_CAP);

    const { row } = await db.canScan(userId, randomUUID());
    assertEqual(row.out_allowed, false, 'out_allowed');
    assertEqual(row.out_reason, 'plus_cap_hit', 'out_reason');
    assertEqual(row.out_remaining, 0, 'out_remaining');
    assertEqual(row.out_paywall, 'unlimited', 'out_paywall');
  });
}

async function burstSuite(db, userId) {
  await test(`${BURST_PER_MIN} scans pass and the next is rate limited, not paywalled`, async () => {
    await db.clearAttempts(userId);
    await db.clearSubscription(userId);
    await db.setBalance(userId, BURST_PER_MIN + 5);

    for (let i = 0; i < BURST_PER_MIN; i += 1) {
      const { row, error } = await db.canScan(userId, randomUUID());
      assert(!error, `scan ${i + 1} errored: ${error?.message}`);
      assertEqual(row.out_allowed, true, `scan ${i + 1} of the burst is allowed`);
    }

    const { row } = await db.canScan(userId, randomUUID());
    assertEqual(row.out_allowed, false, 'the scan past the burst is refused');
    // 'rate_limited' is what makes the caller answer 429 instead of 402: too
    // fast is retryable, out of scans is a verdict.
    assertEqual(row.out_reason, 'rate_limited', 'out_reason');
    assertEqual(row.out_remaining, null, 'out_remaining is null when throttled');
    assertEqual(await db.countByReason(userId, 'scan_used'), BURST_PER_MIN, 'only the allowed scans were charged');
    assertEqual(await db.countAttempts(userId), BURST_PER_MIN, 'the throttled scan did not record an attempt');
  });
}

async function raceSuite(db, userId) {
  await test(`${RACE_WIDTH} parallel captures on a balance of 1 produce exactly one charge`, async () => {
    await db.clearAttempts(userId);
    await db.clearSubscription(userId);
    await db.setBalance(userId, 1);

    // Distinct capture ids on purpose. Reuse one and UNIQUE(user_id, reason,
    // ref_id) absorbs the second write, which would make this pass whether or
    // not the row lock works — the bug is two *different* receipts racing.
    const captureIds = Array.from({ length: RACE_WIDTH }, () => randomUUID());
    const outcomes = await Promise.all(captureIds.map((id) => db.canScan(userId, id)));

    const errored = outcomes.filter((outcome) => outcome.error);
    assertEqual(errored.length, 0, `every call answered (first error: ${errored[0]?.error?.message})`);

    const allowed = outcomes.filter((outcome) => outcome.row.out_allowed === true);
    assertEqual(allowed.length, 1, 'exactly one parallel capture is allowed');
    assertEqual(await db.countByReason(userId, 'scan_used'), 1, 'exactly one charge reached the ledger');
    assertEqual(await db.balance(userId), 0, 'the balance is spent once, not many times');

    const refused = outcomes.filter((outcome) => outcome.row.out_allowed === false);
    assert(
      refused.every((outcome) => outcome.row.out_reason === 'free_exhausted'),
      'the losers are refused for being out of scans, not throttled',
    );
  });
}

async function lockGuardSuite(admin, db, pg) {
  await test('a user with no profiles row is refused loudly, not served unserialised', async () => {
    await withUser(admin, async ({ userId }) => {
      // profiles is the mutex. Without the row, `perform ... for update` matches
      // nothing, locks nothing and — before the guard — raised nothing, so the
      // whole function ran unserialised.
      await db.deleteProfile(userId);

      const { row, error } = await db.canScan(userId, randomUUID());
      assert(error != null, 'can_scan must raise when there is no row to lock, not return a verdict');
      assert(
        /profiles row/i.test(error.message ?? ''),
        `the error should name the missing profiles row, got: ${error.message}`,
      );
      assert(row === null, 'no verdict is returned alongside the error');
    }, pg);
  });
}

// ----------------------------------------------------------------------- main

async function main() {
  const config = resolveConfig({ needDbUrl: true });
  const admin = makeAdmin(config);
  const pg = await connectPg(config);

  console.log(`${TAG} target ${projectRef(config.url)} — creating a throwaway user, no model calls`);

  try {
    await withUser(admin, async ({ userId }) => {
      const db = makeDb(admin, pg);
      await entitlementSuite(db, userId);
      await burstSuite(db, userId);
      await raceSuite(db, userId);
      await lockGuardSuite(admin, db, pg);
    }, pg);
  } finally {
    await pg.end();
  }

  const failed = results.filter((result) => !result.ok);
  const checks = results.reduce((sum, result) => sum + (result.checks ?? 0), 0);

  if (failed.length > 0) {
    console.error(`${TAG} ${failed.length} of ${results.length} tests failed`);
    process.exit(1);
  }

  console.log(`${TAG} can_scan verified live — ${results.length} tests, ${checks} checks`);
}

main().catch((error) => {
  console.error(`${TAG} ${error.message}`);
  process.exit(1);
});
