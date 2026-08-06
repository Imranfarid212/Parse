// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * What POST /export accepts and refuses.
 *
 * The rule worth testing hardest is the last one: an export whose amount filter
 * has no currency would silently compare across currencies, and unlike a search
 * the result leaves the app as a file someone files taxes with.
 *
 * Run: npm run b7:builders
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { validateExportRequest } from '../../_shared/exports/request.ts';

const valid = { filters: {}, format: 'xlsx', include_images: false };

Deno.test('a minimal request is accepted', () => {
  const result = validateExportRequest(valid);
  assert(!result.error, result.error);
  assertEquals(result.request, { filters: {}, format: 'xlsx', include_images: false });
});

Deno.test('an amount filter without a currency is refused', () => {
  const result = validateExportRequest({ ...valid, filters: { amount_min: 10 } });
  assertEquals(result.error, 'Currency is required with amount filters');

  const withCurrency = validateExportRequest({ ...valid, filters: { amount_min: 10, amount_currency: 'USD' } });
  assert(!withCurrency.error, withCurrency.error);
  assertEquals(withCurrency.request.filters, { amount_min: 10, amount_currency: 'USD' });
});

Deno.test('reversed ranges are refused', () => {
  assertEquals(
    validateExportRequest({ ...valid, filters: { date_from: '2026-07-31', date_to: '2026-07-01' } }).error,
    'date_to must be on or after date_from',
  );
  assertEquals(
    validateExportRequest({ ...valid, filters: { amount_min: 90, amount_max: 10, amount_currency: 'USD' } }).error,
    'amount_max must be at least amount_min',
  );
});

Deno.test('formats outside the contract are refused', () => {
  assertEquals(validateExportRequest({ ...valid, format: 'csv' }).error, 'format must be xlsx or pdf');
  assertEquals(validateExportRequest({ ...valid, format: undefined }).error, 'format must be xlsx or pdf');
  assertEquals(validateExportRequest({ filters: {}, format: 'pdf' }).error, 'include_images must be a boolean');
});

Deno.test('malformed filters are refused rather than coerced', () => {
  assertEquals(validateExportRequest({ ...valid, filters: { date_from: '31-07-2026' } }).error, 'date_from must be YYYY-MM-DD');
  assertEquals(validateExportRequest({ ...valid, filters: { amount_currency: 'usd', amount_min: 1 } }).error, 'amount_currency must be an ISO 4217 code');
  assertEquals(validateExportRequest({ ...valid, filters: { category_ids: [1, -2] } }).error, 'category_ids must be positive integers');
  assertEquals(validateExportRequest({ ...valid, filters: { text: 'x'.repeat(121) } }).error, 'text must be at most 120 characters');
  assertEquals(validateExportRequest({ ...valid, filters: [] }).error, 'filters must be an object');
});

Deno.test('a device timezone is accepted, and a malformed one is refused', () => {
  const withZone = validateExportRequest({ ...valid, timezone: 'Asia/Kolkata' });
  assert(!withZone.error, withZone.error);
  assertEquals(withZone.request.timezone, 'Asia/Kolkata');

  // Absent is fine — such an export renders in UTC rather than failing.
  assertEquals(validateExportRequest(valid).request.timezone, undefined);
  assertEquals(validateExportRequest({ ...valid, timezone: '' }).request.timezone, undefined);

  assertEquals(validateExportRequest({ ...valid, timezone: 'Asia/Kolkata; DROP' }).error, 'timezone must be an IANA zone name');
  assertEquals(validateExportRequest({ ...valid, timezone: 'x'.repeat(65) }).error, 'timezone must be an IANA zone name');
  assertEquals(validateExportRequest({ ...valid, timezone: 42 }).error, 'timezone must be an IANA zone name');
});

Deno.test('empty and absent filters mean the same thing', () => {
  const empty = validateExportRequest({ ...valid, filters: { text: '', category_ids: [], amount_currency: '' } });
  assert(!empty.error, empty.error);
  assertEquals(empty.request.filters, {}, 'blank values must not become filters');

  const absent = validateExportRequest({ format: 'pdf', include_images: true });
  assert(!absent.error, absent.error);
  assertEquals(absent.request.filters, {});
});
