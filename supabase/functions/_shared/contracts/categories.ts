/**
 * The category-selection fingerprint, shared by the app and the edge functions.
 *
 * It exists to solve one problem: the extraction functions cache a user's
 * category picks per isolate for a few minutes, and editing that list writes
 * `user_categories` directly — a change no running isolate can observe. Until
 * its cache expired, the model was offered the old list, and `resolveCategoryId`
 * resolved against the same stale map, so a category the user had just removed
 * still had receipts filed into it.
 *
 * The app sends this fingerprint with a scan; the server compares it with the
 * one it cached and goes back to the database when they disagree.
 *
 * It is only ever a cache-invalidation hint. The server never builds a category
 * list from it — a mismatch just sends the server to the database, which
 * remains the sole authority on which categories exist and what ids they carry.
 * The worst a forged value achieves is one extra read of the sender's own row.
 *
 * Both sides MUST agree byte for byte, which is why this lives in contracts and
 * not in either codebase: two implementations that sorted differently would
 * either never invalidate or invalidate on every request.
 *
 * Keep this file dependency-free: it is imported from Deno, where extensionless
 * relative imports do not resolve.
 */

/**
 * Sorted and de-duplicated, because "which categories" is a set question —
 * the order rows come back in is not a change worth a database round trip.
 *
 * Returns '' for an empty selection, which callers treat as "no opinion" and
 * send as absent rather than as a fingerprint: before the app has loaded its
 * categories, an empty list is ignorance, not a selection, and sending it would
 * invalidate the server's perfectly good cache on every cold start.
 */
export function categoriesVersion(ids: readonly number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join('.');
}

/** Longest fingerprint the server will look at; anything larger is ignored. */
export const CATEGORIES_VERSION_MAX_LENGTH = 128;
