/**
 * Redaction rules, isolated from everything that needs a native module.
 *
 * Split out for one reason: the zero-PII guarantee is only worth as much as the
 * evidence for it, and a function that imports react-native cannot be executed
 * by a verification script. Nothing here imports anything, so
 * `scripts/verify-monitoring.js` can load it directly and assert against real
 * tokens, addresses and ids rather than against a re-implementation of these
 * regexes — which would prove only that the script and the app agree.
 */

/** Crashlytics truncates custom keys at 1KB; a message longer than this is noise. */
export const MAX_MESSAGE_LENGTH = 512;
/** Analytics rejects event and parameter names outside this shape, silently. */
export const EVENT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/* -------------------------------------------------------------------------- */
/* Sanitisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Strips everything that could identify a person or authorise a request.
 *
 * Applied to every string that leaves this file, including ones that "cannot"
 * contain anything sensitive: the whole value of a zero-PII guarantee is that
 * it does not depend on the author of each individual call site having been
 * careful. A Supabase error message embeds the failing URL, a network error
 * embeds the request, and both routinely carry a JWT in a query parameter.
 *
 * Order matters. JWTs are matched before the generic long-token rule so they
 * are labelled rather than lumped in with it, and emails before URLs so an
 * address inside a query string is still recognised as an address.
 */
export function sanitizeMessage(input: unknown): string {
  let text =
    typeof input === 'string'
      ? input
      : input instanceof Error
        ? `${input.name}: ${input.message}`
        : (() => {
            try {
              return JSON.stringify(input) ?? String(input);
            } catch {
              // monitoring-ignore: a value that will not serialise still has to yield
              // a string; reporting here would recurse through the sanitiser.
              return String(input);
            }
          })();

  text = text
    // JWTs — access tokens, refresh tokens, the Supabase anon key.
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[jwt]')
    // Credentials named in the surrounding text. The optional scheme word
    // matters: `authorization="Bearer sk-live-…"` otherwise matches only as far
    // as the space after `Bearer`, redacting the scheme and publishing the key.
    .replace(
      /\b(bearer|authorization|apikey|api_key|access_token|refresh_token|password|secret)\b["'\s:=]*(?:bearer\s+|token\s+)?[^\s,;"'}]+/gi,
      '$1=[redacted]',
    )
    // Email addresses.
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    // UUIDs — user ids, device ids, capture ids.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]')
    // Query strings, which is where tokens hide in error messages.
    .replace(/(\bhttps?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?[query]')
    // Local paths carry the developer's or user's account name.
    .replace(/\/Users\/[^/\s]+/g, '/Users/[user]')
    .replace(/\/data\/user\/\d+\/[^/\s]+/g, '/data/user/[user]')
    // Anything else long enough to be a key, hash or base64 payload.
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, '[redacted]')
    // Long digit runs: card numbers, phone numbers, account numbers. Seven is
    // above any HTTP status, port or millisecond duration we log.
    .replace(/\b\d{7,}\b/g, '[number]');

  if (text.length > MAX_MESSAGE_LENGTH) text = `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
  return text;
}

/**
 * Event parameters are sanitised by the same rules, and anything that is not a
 * primitive is dropped rather than stringified — a nested object is how a whole
 * receipt ends up in an analytics payload.
 */
export function sanitizeParams(params?: Record<string, unknown>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  if (!params) return safe;

  for (const [key, value] of Object.entries(params)) {
    if (!EVENT_NAME_RE.test(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'string') safe[key] = sanitizeMessage(value);
  }
  return safe;
}
