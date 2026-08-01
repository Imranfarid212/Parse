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

function excludes(source, needle, label) {
  if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`);
}

function excludesPattern(source, pattern, label) {
  if (pattern.test(source)) fail(`${label}: did not expect /${pattern.source}/`);
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
const balancedFn = read('supabase/functions/extract-balanced/index.ts');
const sharedCategories = read('supabase/functions/_shared/categories.ts');
const quotaModule = read('supabase/functions/_shared/quota.ts');
const contractsQuota = read('packages/contracts/src/quota.ts');
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
includes(confirmFn, "{ status: 'confirmed', confirmed_via: 'user' }", 'user confirmation status transition');
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

// ── Balanced fast path (extract-balanced) ───────────────────────────────────
// The default extraction mode. These checks exist because it is entirely
// separate code from `extract` above, and every rule below was broken in it at
// some point while this file reported PASSED.

includes(balancedFn, "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')", 'balanced service role server env');
if (/EXPO_PUBLIC_.*XAI|EXPO_PUBLIC_.*GROK|EXPO_PUBLIC_.*GEMINI|EXPO_PUBLIC_.*OPENROUTER|sk-[A-Za-z0-9]/.test(balancedFn)) {
  fail('balanced provider secret must not be exposed or hardcoded');
}

// The quota RULE lives once, in contracts, and is shared by both extraction
// modes and by the client's shutter gate. A free user must not be able to
// bypass the cap by switching mode, and the client must not invent its own
// arithmetic.
includes(contractsQuota, 'PLUS_MONTHLY_CAP = 500', 'shared quota Plus cap');
includes(contractsQuota, "PRODUCT_PLUS = 'rf_plus_699_m'", 'shared quota Plus product id');
includes(contractsQuota, "PRODUCT_UNLIMITED = 'rf_unlimited_1199_m'", 'shared quota Unlimited product id');
includes(contractsQuota, 'export function decideQuota', 'quota rule is one pure function');
// Imported from Deno, where extensionless relative imports do not resolve.
excludesPattern(contractsQuota, /^import\s/m, 'contracts quota rule must stay dependency-free');

includes(quotaModule, "from './contracts/quota.ts'", 'server quota defers to the shared rule');
includes(quotaModule, 'current_period_start', 'quota counts from the subscription period start');
includes(quotaModule, "'active', 'grace'", 'grace counts as active for quota');
includes(fn, "from '../_shared/quota.ts'", 'precise uses the shared quota module');
includes(balancedFn, "from '../_shared/quota.ts'", 'balanced uses the shared quota module');
excludes(fn, 'rf_plus_699_m', 'precise must not re-implement product tiers');
excludes(balancedFn, 'rf_plus_699_m', 'balanced must not re-implement product tiers');
excludes(quotaModule, 'PLUS_MONTHLY_CAP = 500', 'server must not re-declare the cap');

// The balance rides back on a call the client already made, so the cached
// figure refreshes without a second request.
includes(fn, 'scans_remaining:', 'precise reports the remaining balance');
includes(balancedFn, 'scans_remaining:', 'balanced reports the remaining balance');

includes(balancedFn, 'evaluateQuota(admin, userId)', 'balanced runs can_scan');
includes(balancedFn, 'if (!quota.canScan)', 'balanced enforces the quota verdict');
includes(balancedFn, "code: 'QUOTA_EXHAUSTED'", 'balanced quota exhausted response');
includes(balancedFn, "reason: 'scan_used'", 'balanced quota credit ledger debit');
includes(balancedFn, "ledgerError.code !== '23505'", 'balanced duplicate scan ledger idempotency');
// Both anchors live in the request handler, so source order is execution order:
// the verdict is checked, and an exhausted account returns, before anything is
// persisted or charged.
order(balancedFn, 'evaluateQuota(admin, userId)', 'if (!quota.canScan)', 'quota verdict is awaited before use');
order(balancedFn, 'if (!quota.canScan)', 'persistResultWithJob({', 'exhausted accounts never reach persistence');

// The receipt row is claimed before the model call, so the id returned to the
// client always exists and a redelivered capture_id reuses the same row.
includes(balancedFn, 'async function reserveReceipt', 'balanced reserves the receipt row');
includes(balancedFn, "status: 'processing'", 'reservation lands in the processing state');
includes(balancedFn, 'ignoreDuplicates: true', 'redelivered capture_id reuses the existing row');
includes(balancedFn, 'const receiptId = reservation.id', 'response id comes from the database');
orderBeforeLast(balancedFn, 'const receiptId = reservation.id', 'receipt_id: receiptId', 'reserved id is what the client receives');
includes(balancedFn, ".eq('status', 'processing')", 'persist only claims a row still processing');
excludesPattern(balancedFn, /\bid: receiptId,\s*\n\s*user_id:/, 'balanced must not re-upsert a client-minted receipt id');

// Categories come from the user's own picks, not a hardcoded list. The read and
// the name->id rule live in _shared so extraction and confirmation cannot drift
// apart the way Balanced drifted from Precise; both must import them.
includes(sharedCategories, 'async function getUserCategories', 'shared module reads the user categories');
includes(sharedCategories, ".from('user_categories')", 'shared module queries user_categories');
includes(sharedCategories, 'idByName.get(name) ?? categories.fallbackId', 'shared name->id rule falls back to Miscellaneous');
includes(balancedFn, "from '../_shared/categories.ts'", 'balanced uses the shared category module');
excludesPattern(balancedFn, /async function getUserCategories/, 'balanced must not re-declare the category read');
includes(balancedFn, 'buildPrompt(ocrText, defaultCurrency, categories.names)', 'prompt uses the user categories');
includes(balancedFn, 'enum: categoryNames', 'model schema is constrained to the user categories');
includes(balancedFn, 'categoryNames.includes(category) ? category : MISCELLANEOUS', 'off-list category fallback');
includes(balancedFn, 'category_id: categoryId', 'balanced persists the resolved category id');
includes(balancedFn, 'resolveCategoryId(categories,', 'balanced resolves the id through the shared rule');
excludesPattern(balancedFn, /category_id:\s*\d+/, 'balanced must not hardcode a category id');

// Confirmation is the only path by which a user's edits reach the database.
// Without these it silently stored nothing but a status flag, and every
// correction lived on one device.
includes(confirmFn, "from '../_shared/categories.ts'", 'confirm uses the shared category module');
includes(confirmFn, 'patch.merchant', 'confirm persists the edited merchant');
includes(confirmFn, 'patch.txn_date', 'confirm persists the edited date');
includes(confirmFn, 'patch.total', 'confirm persists the edited total');
includes(confirmFn, 'patch.currency', 'confirm persists the edited currency');
includes(confirmFn, 'patch.category_id = resolveCategoryId(', 'confirm resolves the category through the shared rule');
includes(confirmFn, '.update(patch)', 'confirm writes the field patch, not just a status');
excludesPattern(confirmFn, /\.update\(\{\s*status:\s*'confirmed',\s*confirmed_via:\s*'user'\s*\}\)/, 'confirm must not go back to writing only a status');

console.log('[b4:backend] Grok fast path, balanced fast path, shared quota, validation, and ack-gate source checks passed');
