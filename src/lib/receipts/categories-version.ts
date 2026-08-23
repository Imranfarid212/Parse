/**
 * The fingerprint of the signed-in user's category picks, for outgoing requests.
 *
 * Ambient rather than threaded through every call site, deliberately: `confirm`
 * reaches the network through the `ConfirmReceiptClient` interface and `extract`
 * through `ExtractInput`, so passing it as an argument would mean widening two
 * public shapes and every caller of both — to carry one string that is a
 * property of the session, not of the request. `client.ts` already reads the
 * access token and the device id this way, and this is the same kind of value.
 *
 * AuthProvider is the only writer, and it writes on every change to the
 * selection, so there is exactly one source of truth in the app.
 */
import { categoriesVersion } from '@/../packages/contracts/src/categories';

let current: string | null = null;

/**
 * Called by AuthProvider whenever the selection changes.
 *
 * An empty selection stores null rather than '': before the categories have
 * loaded, empty means "not known yet", and sending a fingerprint for it would
 * tell the server its cache is wrong on every cold start — inverting the point
 * of the thing.
 */
export function setCategoriesVersion(ids: readonly number[]): void {
  const next = categoriesVersion(ids);
  current = next.length > 0 ? next : null;
}

/** Null when unknown, in which case requests omit it and the server falls back to its timer. */
export function getCategoriesVersion(): string | null {
  return current;
}
