// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The category cache, and the fingerprint that invalidates it.
 *
 * Every case here is a silent wrong answer rather than an error: the cache
 * serving a list the user has already changed does not fail, it files receipts
 * into the wrong category. The window is minutes long and per-isolate, so it is
 * not reproducible by hand — which is exactly why it is pinned here.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { categoriesVersion } from '../../_shared/contracts/categories.ts';
import { getUserCategories, resolveCategoryId, MISCELLANEOUS } from '../../_shared/categories.ts';

/** A stand-in for the `user_categories` join, counting how often it is read. */
function fakeAdmin(rows: { id: number; name: string }[]) {
  const state = { reads: 0, rows };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => {
          state.reads += 1;
          return Promise.resolve({ data: state.rows.map((row) => ({ categories: row })), error: null });
        },
      }),
    }),
  };
  return { client, state };
}

const TRAVEL = { id: 1, name: 'Travel & Transit' };
const MEALS = { id: 2, name: 'Meals & Entertainment' };
const VEHICLE = { id: 5, name: 'Vehicle Expenses' };
const MISC = { id: 10, name: MISCELLANEOUS };

// Each test uses its own user id: the cache is module state and outlives a test.
let seq = 0;
const nextUser = () => `user-${++seq}`;

Deno.test('fingerprints ignore order and duplicates, and separate real changes', () => {
  assertEquals(categoriesVersion([2, 1, 10]), categoriesVersion([10, 1, 2]), 'order is not a change');
  assertEquals(categoriesVersion([1, 1, 2]), categoriesVersion([1, 2]), 'duplicates are not a change');
  assert(categoriesVersion([1, 2, 10]) !== categoriesVersion([1, 2, 5, 10]), 'an added category is a change');
  assert(categoriesVersion([1, 2, 10]) !== categoriesVersion([1, 10]), 'a removed category is a change');
  assertEquals(categoriesVersion([]), '', 'an empty selection has no fingerprint');
});

Deno.test('a matching fingerprint is served from cache without touching the database', async () => {
  const userId = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MEALS, MISC]);
  const version = categoriesVersion([1, 2, 10]);

  await getUserCategories(client, userId, undefined, 'test', version);
  assertEquals(state.reads, 1, 'the first call has to read');

  await getUserCategories(client, userId, undefined, 'test', version);
  await getUserCategories(client, userId, undefined, 'test', version);
  assertEquals(state.reads, 1, 'an unchanged selection never reads again');
});

Deno.test('adding a category invalidates the cache, so the model can actually pick it', async () => {
  const userId = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MEALS, MISC]);

  const before = await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 2, 10]));
  assertEquals(before.names.includes('Vehicle Expenses'), false);

  // The user adds Vehicle Expenses: user_categories changes, and the app's
  // fingerprint changes with it.
  state.rows = [TRAVEL, MEALS, VEHICLE, MISC];
  const after = await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 2, 5, 10]));

  assertEquals(state.reads, 2, 'a changed fingerprint forces a re-read');
  assert(after.names.includes('Vehicle Expenses'), 'the new category reaches the prompt and the schema enum');
  assertEquals(resolveCategoryId(after, 'Vehicle Expenses'), 5, 'and it can be stored');
});

Deno.test('removing a category stops receipts being filed into it', async () => {
  const userId = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MEALS, VEHICLE, MISC]);

  const before = await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 2, 5, 10]));
  assertEquals(resolveCategoryId(before, 'Vehicle Expenses'), 5);

  // The user removes it. This is the dangerous direction: with a stale cache
  // the model is still offered the name AND resolveCategoryId still maps it,
  // so the receipt lands in a category the account no longer has.
  state.rows = [TRAVEL, MEALS, MISC];
  const after = await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 2, 10]));

  assertEquals(after.names.includes('Vehicle Expenses'), false, 'it is no longer offered');
  assertEquals(resolveCategoryId(after, 'Vehicle Expenses'), 10, 'and it falls back to Miscellaneous');
});

Deno.test('no fingerprint keeps the old time-based behaviour', async () => {
  const userId = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MISC]);

  await getUserCategories(client, userId, undefined, 'test');
  await getUserCategories(client, userId, undefined, 'test', null);
  await getUserCategories(client, userId, undefined, 'test', undefined);

  // An app too old to send one, and the durable job path, must not be punished
  // with a database read per call.
  assertEquals(state.reads, 1, 'absent fingerprints fall back to the cache timer');
});

Deno.test('the cache is versioned from the database, so a wrong hint self-corrects', async () => {
  const userId = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MISC]);

  // A client sending nonsense forces one read...
  await getUserCategories(client, userId, undefined, 'test', 'not-a-real-version');
  assertEquals(state.reads, 1);

  // ...and the entry is then stamped with the TRUTH, not with what was sent, so
  // an honest client immediately gets a hit rather than another read.
  await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 10]));
  assertEquals(state.reads, 1, 'the cached version came from the database');

  // The same nonsense forces exactly one more read: it can never poison the
  // stored list, only cost its own sender a lookup.
  await getUserCategories(client, userId, undefined, 'test', 'not-a-real-version');
  assertEquals(state.reads, 2);
  const value = await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 10]));
  assertEquals(value.names, ['Travel & Transit', MISCELLANEOUS], 'the list is always the database list');
});

Deno.test('one user\'s change does not disturb another\'s cache', async () => {
  const alice = nextUser();
  const bob = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MISC]);

  await getUserCategories(client, alice, undefined, 'test', categoriesVersion([1, 10]));
  await getUserCategories(client, bob, undefined, 'test', categoriesVersion([1, 10]));
  assertEquals(state.reads, 2, 'each user is cached separately');

  await getUserCategories(client, alice, undefined, 'test', categoriesVersion([1, 2, 10]));
  assertEquals(state.reads, 3);
  await getUserCategories(client, bob, undefined, 'test', categoriesVersion([1, 10]));
  assertEquals(state.reads, 3, "bob's entry survived alice's change");
});

Deno.test('a failed read serves the last good list rather than failing the scan', async () => {
  const userId = nextUser();
  const { client, state } = fakeAdmin([TRAVEL, MEALS, MISC]);
  await getUserCategories(client, userId, undefined, 'test', categoriesVersion([1, 2, 10]));

  const broken = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('db down') }) }) }),
  };
  const value = await getUserCategories(broken, userId, undefined, 'test', categoriesVersion([1, 2, 5, 10]));

  // Invalidation asked for a fresh read and the database refused. Falling back
  // to the stale list is deliberate: a slightly wrong category beats a scan
  // that dies on a category lookup.
  assertEquals(value.names, ['Travel & Transit', 'Meals & Entertainment', MISCELLANEOUS]);
  assertEquals(state.reads, 1);
});
