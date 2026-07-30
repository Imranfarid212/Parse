const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b4:backend] ${message}`);
}

function includes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
}

function order(source, before, after, label) {
  const a = source.indexOf(before);
  const b = source.indexOf(after);
  if (a === -1 || b === -1 || a > b) fail(`${label}: expected ${JSON.stringify(before)} before ${JSON.stringify(after)}`);
}

function orderBeforeLast(source, before, after, label) {
  const a = source.indexOf(before);
  const b = source.lastIndexOf(after);
  if (a === -1 || b === -1 || a > b) fail(`${label}: expected ${JSON.stringify(before)} before final ${JSON.stringify(after)}`);
}

const fn = read('supabase/functions/extract/index.ts');
const confirmFn = read('supabase/functions/receipt-confirm/index.ts');
const schemas = read('packages/contracts/src/schemas.ts');
const mirrorSchemas = read('supabase/functions/_shared/contracts/schemas.ts');
const fixtures = read('packages/contracts/src/fixtures.ts');
const grants = read('supabase/migrations/20260723000100_b4_extract_fast_path_grants.sql');
const quotaReadGrants = read('supabase/migrations/20260723000200_b4_quota_read_grants.sql');

if (schemas !== mirrorSchemas) fail('contracts mirror differs; run npm run contracts:sync');

includes(fn, "Deno.env.get('XAI_API_KEY')", 'server-only Grok key');
includes(fn, "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')", 'service role server env');
if (/EXPO_PUBLIC_.*XAI|EXPO_PUBLIC_.*GROK|sk-[A-Za-z0-9]/.test(fn)) fail('provider secret must not be exposed or hardcoded');

includes(fn, 'XAI_CHAT_COMPLETIONS_URL', 'Grok provider endpoint');
includes(fn, 'buildPrompt(categories, defaultCurrency)', 'prompt uses selected categories');
includes(fn, 'Analyze this photo of a receipt', 'terse user-provided prompt');
includes(fn, 'No text outside the JSON', 'JSON-only prompt guard');
includes(fn, "response_format: { type: 'json_object' }", 'JSON object mode');
includes(fn, 'max_tokens: 320', 'Grok output token cap');
includes(fn, 'grok_ms', 'Grok latency metric');
includes(fn, 'storage_ms', 'storage latency metric');
includes(fn, 'total_ms', 'total latency metric');
includes(fn, 'parseJsonObject', 'model JSON parser');
includes(fn, 'repairExtraction', 'malformed repair retry');
includes(fn, "categories.includes(category) ? category : 'Miscellaneous'", 'off-list category fallback');
includes(fn, "is_receipt: false", 'non-receipt fixture path');
includes(fn, "status = extraction.is_receipt ? (mode === 'one_click' ? 'confirmed' : 'needs_review') : 'rejected'", 'mode status split');
includes(fn, "confirmed_via: confirmedVia", 'one-click auto-confirm persistence');
includes(fn, 'normalizeMerchantKey', 'duplicate merchant normalization');
includes(fn, "duplicate: true", 'duplicate receipt response');
includes(fn, ".neq('capture_id', captureId)", 'duplicate ignores same capture id');
includes(fn, ".in('status', ['needs_review', 'confirmed'])", 'duplicate scans only terminal review/confirmed rows');
includes(fn, "await admin.storage.from('receipts').remove([imagePath]);", 'duplicate image cleanup');
includes(confirmFn, "update({ status: 'confirmed', confirmed_via: 'user' })", 'user confirmation status transition');
includes(confirmFn, ".eq('user_id', userData.user.id)", 'confirmation ownership guard');
includes(confirmFn, "receipt_id must be a UUID", 'confirmation id validation');
includes(fn, ".from('receipt_items').insert", 'line item persistence');
includes(fn, "reason: 'scan_used'", 'quota credit ledger debit');
includes(fn, "ledgerError.code !== '23505'", 'duplicate scan ledger idempotency');
includes(fn, "return json(402, { status: 402, code: 'QUOTA_EXHAUSTED'", 'quota exhausted response');
includes(fn, ".storage.from('receipts').remove([imagePath])", 'non-receipt image deletion');
includes(fn, "x-rf-force-storage-failure", 'forced storage failure drill');
includes(fn, 'Promise.all([', 'storage and provider parallel fast path');
order(fn, "req.headers.get('x-rf-force-storage-failure')", "admin.storage.from('receipts').upload", 'forced storage failure before upload');
order(fn, "admin.storage.from('receipts').upload", ".upsert(\n      {", 'ack gate upload before receipt commit');
orderBeforeLast(fn, ".upsert(\n      {", 'return json(200', 'ack gate receipt commit before response');

includes(schemas, 'rejected: z.literal(true)', 'contract rejected 200 shape');
includes(schemas, 'is_receipt: z.literal(false)', 'contract non-receipt result');
includes(fixtures, 'malformedExtractionFixture', 'T4.1 malformed fixture');
includes(fixtures, 'offListCategoryExtractionFixture', 'T4.1 off-list fixture');
includes(fixtures, 'nonReceiptExtractionFixture', 'T4.1 non-receipt fixture');

includes(grants, 'grant select on public.profiles to service_role', 'service role profile read grant');
includes(grants, 'grant select on public.user_categories to service_role', 'service role selected categories read grant');
includes(grants, 'grant select, insert, update on public.receipts to service_role', 'service role receipt write grant');
includes(grants, 'grant select, insert, update, delete on public.receipt_items to service_role', 'service role receipt item grant');
includes(grants, 'grant select, insert on public.scan_ledger to service_role', 'service role quota ledger grant');
includes(quotaReadGrants, 'grant select on public.subscriptions to authenticated, service_role', 'quota subscription read grant');
includes(quotaReadGrants, 'grant select on public.scan_ledger to authenticated, service_role', 'quota ledger read grant');

console.log('[b4:backend] Grok fast path, validation, quota, and ack-gate source checks passed');
