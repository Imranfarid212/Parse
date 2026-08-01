// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The user's own category picks, and the rule for turning a category name into
 * the id a receipt is stored under.
 *
 * This lives here rather than inside one function because two paths now need
 * it: extraction, which offers the model only the user's selections and stores
 * whatever it chose, and confirmation, which stores whatever the user chose
 * after editing. The same rule in two files is how the Balanced path silently
 * drifted from Precise — see the B4 handover. One copy, both callers.
 *
 * Deployment note: shared code is copied into each function at deploy time, so
 * a change here means redeploying every function that imports it.
 */

export const MISCELLANEOUS = 'Miscellaneous';
export const MISCELLANEOUS_ID = 10;

/**
 * The seeded master list from the B1 migration. The prompt and the persisted
 * category_id come from the user's own `user_categories` picks; this is only the
 * fallback for when that read fails, so a scan never dies over a category lookup.
 */
export const SEEDED_CATEGORIES = [
  { id: 1, name: 'Travel & Transit' },
  { id: 2, name: 'Meals & Entertainment' },
  { id: 3, name: 'Office Supplies' },
  { id: 4, name: 'Software & IT' },
  { id: 5, name: 'Vehicle Expenses' },
  { id: 6, name: 'Advertising & Marketing' },
  { id: 7, name: 'Professional Services' },
  { id: 8, name: 'Utilities & Telecom' },
  { id: 9, name: 'Inventory & Materials' },
  { id: 10, name: MISCELLANEOUS },
] as const;

/**
 * The user's selected categories: what the model may choose from, and the id
 * each name persists as. Miscellaneous is always present (it is the locked
 * system category and the off-list fallback).
 */
export type UserCategories = { names: string[]; idByName: Map<string, number>; fallbackId: number };

/** Just the slice of a supabase-js client this needs, so callers can pass either. */
type QueryClient = { from: (table: string) => any };

const CATEGORY_CACHE_MS = 5 * 60 * 1000;
const categoryCache = new Map<string, { value: UserCategories; fetchedAt: number }>();

export const SEEDED_USER_CATEGORIES: UserCategories = {
  names: SEEDED_CATEGORIES.map((category) => category.name),
  idByName: new Map(SEEDED_CATEGORIES.map((category) => [category.name, category.id])),
  fallbackId: MISCELLANEOUS_ID,
};

const shortError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 240);

/**
 * The user's own category picks, cached per isolate so the hot path usually pays
 * nothing. The camera's warm-up call primes this before the shutter is pressed.
 * A failed read falls back to the seeded list rather than failing the caller.
 */
export async function getUserCategories(
  admin: QueryClient,
  userId: string,
  timing?: Record<string, unknown>,
  label = 'categories',
): Promise<UserCategories> {
  const cached = categoryCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CATEGORY_CACHE_MS) {
    if (timing) {
      timing.categories_ms = 0;
      timing.categories_cached = 1;
    }
    return cached.value;
  }

  const startedAt = performance.now();
  try {
    const { data, error } = await admin.from('user_categories').select('categories(id, name)').eq('user_id', userId);
    if (error) throw error;

    const rows = (data ?? [])
      .map((row: Record<string, unknown>) => row.categories as { id: number; name: string } | null)
      .filter((row): row is { id: number; name: string } => Boolean(row?.name));
    if (rows.length === 0) throw new Error('user has no selected categories');

    const idByName = new Map(rows.map((row) => [row.name, row.id]));
    // Miscellaneous is the locked system category and the off-list fallback, so
    // it is always offered even if the join somehow missed it.
    if (!idByName.has(MISCELLANEOUS)) idByName.set(MISCELLANEOUS, MISCELLANEOUS_ID);
    const value: UserCategories = {
      names: [...idByName.keys()],
      idByName,
      fallbackId: idByName.get(MISCELLANEOUS) ?? MISCELLANEOUS_ID,
    };
    categoryCache.set(userId, { value, fetchedAt: Date.now() });
    if (timing) {
      timing.categories_ms = Math.round(performance.now() - startedAt);
      timing.categories_cached = 0;
    }
    return value;
  } catch (error) {
    console.error(`[${label}] category read failed; using seeded list`, {
      user_id: userId,
      error: shortError(error),
    });
    if (timing) {
      timing.categories_ms = Math.round(performance.now() - startedAt);
      timing.categories_cached = 0;
      timing.categories_fallback = 1;
    }
    return cached?.value ?? SEEDED_USER_CATEGORIES;
  }
}

/**
 * A category name becomes an id only if the user actually selected it —
 * anything else lands on Miscellaneous. This is the rule that keeps a client
 * (or a model) from writing a category the account does not have.
 */
export function resolveCategoryId(categories: UserCategories, name: unknown): number {
  if (typeof name !== 'string') return categories.fallbackId;
  return categories.idByName.get(name) ?? categories.fallbackId;
}
