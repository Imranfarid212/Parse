/**
 * The offline auth snapshot — the app's own record of *who is signed in*.
 *
 * Supabase owns the tokens; this owns the identity, and the split is what makes
 * a cold start without a network survivable. Offline, an access token past its
 * lifetime cannot be refreshed, so `getSession()` answers `null` — while
 * deliberately leaving the tokens in SecureStore, because a failed fetch is a
 * retryable error and never a sign-out. Without a local record of the user the
 * app cannot tell that apart from "no account", and drops someone on the
 * sign-in screen while their session sits valid on disk.
 *
 * Written after every successful profile refresh, read once at startup, and
 * cleared only on a real sign-out. Like the quota cache it lives in the
 * ordinary local database rather than SecureStore: none of it is secret and
 * none of it is authority — every server read is still gated by RLS, so a
 * tampered snapshot buys nothing but a wrong name on a settings screen.
 *
 * Single row by construction (`id = 1`): one signed-in user at a time, so a
 * sign-in cannot leave the previous account's profile behind.
 *
 * The table is declared with the rest of the schema in `receipts/store.ts`,
 * which owns the database file; only the accessors live here.
 */
import type { User } from '@supabase/supabase-js';

import type { Category } from '@/../packages/contracts/src/types';
import type { Profile } from '@/lib/auth/types';
import { getDb } from '@/lib/receipts/store';

export type CachedAuth = {
  userId: string;
  user: User | null;
  profile: Profile | null;
  categories: Category[];
  selectedCategoryIds: number[];
  fetchedAt: number;
};

type AuthCacheRow = {
  user_id: string;
  user_json: string | null;
  profile_json: string | null;
  categories_json: string;
  selected_category_ids_json: string;
  fetched_at: number;
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Returns null when nothing has been cached yet, or the row is unreadable. */
export async function getCachedAuth(): Promise<CachedAuth | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AuthCacheRow>(
    `SELECT user_id, user_json, profile_json, categories_json, selected_category_ids_json, fetched_at
       FROM auth_cache WHERE id = 1`,
  );
  if (!row?.user_id) return null;

  const categories = parseJson<Category[]>(row.categories_json, []);
  const selectedCategoryIds = parseJson<number[]>(row.selected_category_ids_json, []);

  return {
    userId: row.user_id,
    user: parseJson<User | null>(row.user_json, null),
    profile: parseJson<Profile | null>(row.profile_json, null),
    categories: Array.isArray(categories) ? categories : [],
    selectedCategoryIds: Array.isArray(selectedCategoryIds) ? selectedCategoryIds : [],
    fetchedAt: row.fetched_at,
  };
}

export async function setCachedAuth(snapshot: Omit<CachedAuth, 'fetchedAt'>): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO auth_cache (id, user_id, user_json, profile_json, categories_json,
       selected_category_ids_json, fetched_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, user_json = excluded.user_json,
       profile_json = excluded.profile_json, categories_json = excluded.categories_json,
       selected_category_ids_json = excluded.selected_category_ids_json,
       fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    [
      snapshot.userId,
      snapshot.user ? JSON.stringify(snapshot.user) : null,
      snapshot.profile ? JSON.stringify(snapshot.profile) : null,
      JSON.stringify(snapshot.categories ?? []),
      JSON.stringify(snapshot.selectedCategoryIds ?? []),
      now,
      now,
    ],
  );
}

/** Only ever called for a real sign-out — never for a failed request. */
export async function clearCachedAuth(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM auth_cache');
}
