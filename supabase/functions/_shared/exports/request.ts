// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Validation for POST /export.
 *
 * Hand-written against packages/contracts/src/schemas.ts rather than running zod
 * here — the functions have no bare-specifier resolution, and the rules are few
 * enough to state twice honestly. The b7 backend check pins the two copies
 * together so a rule cannot be tightened on one side only.
 *
 * It lives outside index.ts so it can be tested without booting a server, which
 * matters more than usual here: the last rule below is the one that keeps an
 * export from comparing amounts across currencies (D13), and an export is
 * exactly where a silently-defaulted currency would look authoritative.
 */
const isIsoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function validateExportRequest(body: Record<string, unknown>) {
  if (!body || typeof body !== 'object') return { error: 'A JSON body is required' };

  const format = body.format;
  if (format !== 'xlsx' && format !== 'pdf') return { error: 'format must be xlsx or pdf' };

  const includeImages = body.include_images;
  if (typeof includeImages !== 'boolean') return { error: 'include_images must be a boolean' };

  const raw = (body.filters ?? {}) as Record<string, unknown>;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'filters must be an object' };

  const filters: Record<string, unknown> = {};

  if (raw.text !== undefined && raw.text !== null && raw.text !== '') {
    if (typeof raw.text !== 'string' || raw.text.length > 120) return { error: 'text must be at most 120 characters' };
    filters.text = raw.text.trim();
  }

  for (const key of ['date_from', 'date_to']) {
    if (raw[key] === undefined || raw[key] === null) continue;
    if (!isIsoDate(raw[key])) return { error: `${key} must be YYYY-MM-DD` };
    filters[key] = raw[key];
  }
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) {
    return { error: 'date_to must be on or after date_from' };
  }

  if (raw.category_ids !== undefined && raw.category_ids !== null) {
    if (!Array.isArray(raw.category_ids) || raw.category_ids.length > 100) {
      return { error: 'category_ids must be an array of at most 100 ids' };
    }
    const ids = raw.category_ids.map((value) => Number(value));
    if (ids.some((value) => !Number.isInteger(value) || value <= 0)) return { error: 'category_ids must be positive integers' };
    if (ids.length > 0) filters.category_ids = ids;
  }

  for (const key of ['amount_min', 'amount_max']) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < 0) return { error: `${key} must be zero or greater` };
    filters[key] = value;
  }
  if (filters.amount_min !== undefined && filters.amount_max !== undefined && filters.amount_min > filters.amount_max) {
    return { error: 'amount_max must be at least amount_min' };
  }

  if (raw.amount_currency !== undefined && raw.amount_currency !== null && raw.amount_currency !== '') {
    if (!isCurrency(raw.amount_currency)) return { error: 'amount_currency must be an ISO 4217 code' };
    filters.amount_currency = raw.amount_currency;
  }
  if ((filters.amount_min !== undefined || filters.amount_max !== undefined) && !filters.amount_currency) {
    return { error: 'Currency is required with amount filters' };
  }

  let timezone;
  if (body.timezone !== undefined && body.timezone !== null && body.timezone !== '') {
    // Shape only. Whether the runtime can actually format in this zone is
    // decided at render time, where an unknown zone falls back to UTC — an
    // export is not worth losing over the label on one line.
    if (typeof body.timezone !== 'string' || body.timezone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(body.timezone)) {
      return { error: 'timezone must be an IANA zone name' };
    }
    timezone = body.timezone;
  }

  // The key is omitted rather than set to undefined when absent, so the parsed
  // request is exactly the set of things the caller actually asked for.
  return { request: { filters, format, include_images: includeImages, ...(timezone ? { timezone } : {}) } };
}
