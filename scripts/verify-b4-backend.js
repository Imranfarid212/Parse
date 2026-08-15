const fs = require('fs');
const path = require('path');

const { rewriteRelativeImports } = require('./contracts-sync');

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
const products = read('packages/contracts/src/products.ts');
const mirrorSchemas = read('supabase/functions/_shared/contracts/schemas.ts');
const fixtures = read('packages/contracts/src/fixtures.ts');
const grants = read('supabase/migrations/20260723000100_b4_extract_fast_path_grants.sql');
const quotaReadGrants = read('supabase/migrations/20260723000200_b4_quota_read_grants.sql');
// The newest migration that redefines can_scan() is the current definition.
// Point this at the latest one whenever the function is replaced, or these
// assertions quietly start proofreading a superseded file.
const canScanSql = read('supabase/migrations/20260802000100_b4_can_scan_profile_guard.sql');
const refundSql = read('supabase/migrations/20260801000200_b4_can_scan_unambiguous.sql');
const deviceSql = read('supabase/migrations/20260803000100_b4_single_device_takeover.sql');
const deviceClient = read('src/lib/auth/device.ts');
const authContext = read('src/lib/auth/auth-context.tsx');
const receiptClient = read('src/lib/receipts/client.ts');
const metricsFn = read('supabase/functions/capture-metrics/index.ts');

// Compared through the same rewrite contracts:sync applies, because the mirror
// is deliberately not byte-identical any more: Deno needs .ts on relative
// import specifiers and the app must not have them.
if (rewriteRelativeImports(schemas) !== mirrorSchemas) fail('contracts mirror differs; run npm run contracts:sync');

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
includes(confirmFn, "p_user_id: userData.user.id", 'confirmation ownership guard');
includes(confirmFn, "receipt_id must be a UUID", 'confirmation id validation');
includes(confirmFn, "admin.rpc('confirm_receipt_with_items'", 'confirmation commits structured items through one RPC');
includes(confirmFn, 'const items = normalizeItems(body?.fields?.items)', 'confirmation validates structured items');
const confirmItemsSql = read('supabase/migrations/20260803000200_b4_confirm_structured_items.sql');
includes(confirmItemsSql, 'function public.confirm_receipt_with_items', 'transactional confirmation function exists');
includes(confirmItemsSql, 'delete from public.receipt_items', 'confirmation replaces old item rows');
includes(confirmItemsSql, 'jsonb_to_recordset(p_items)', 'confirmation inserts structured item rows');
includes(fn, ".from('receipt_items').insert", 'line item persistence');
includes(fn, 'refundScan(admin, userId, captureId)', 'rejected image gives the scan back');
includes(fn, "return json(402, { status: 402, code: 'QUOTA_EXHAUSTED'", 'quota exhausted response');
includes(fn, ".storage.from('receipts').remove([imagePath])", 'non-receipt image deletion');
includes(fn, "x-rf-force-storage-failure", 'forced storage failure drill');
includes(fn, 'Promise.all([', 'storage and provider parallel fast path');
order(fn, "req.headers.get('x-rf-force-storage-failure')", "admin.storage.from('receipts').upload", 'forced storage failure before upload');
order(fn, "req.headers.get('x-rf-force-storage-failure')", 'if (uploadOnly && image instanceof File)', 'forced storage failure also covers upload_only backups');
order(fn, "admin.storage.from('receipts').upload", ".upsert(\n      {", 'ack gate upload before receipt commit');
orderBeforeLast(fn, ".upsert(\n      {", 'return json(200', 'ack gate receipt commit before response');

/**
 * T4.4 on the Balanced path.
 *
 * Every ack-gate assertion above runs against `fn` — extract/index.ts, the
 * Precise path. `extract-balanced` is read separately as `balancedFn` and had no
 * ack assertion of any kind, so T4.4 was green while the path the app actually
 * defaults to was uncovered. It looked protected and was not.
 *
 * Under DL-002 the two paths carry different obligations, so each needs its own
 * check rather than one shared one. Balanced never receives the image, so there
 * is no Storage write to gate; what it owes instead is honesty — it must not
 * name a path for an object that does not exist. It previously returned
 * `${userId}/${captureId}.jpg` in its 200, which nothing consumed but the
 * contract entitled a consumer to trust.
 */
includes(balancedFn, 'image_path: null,', 'balanced advertises no image path it cannot serve');
if (/image_path:\s*`\$\{userId\}\/\$\{captureId\}\.jpg`/.test(balancedFn)) {
  fail('balanced must not return a storage path for an image it never received');
}
if (/\.storage\s*\n?\s*\.from\('receipts'\)\s*\n?\s*\.upload\(/.test(balancedFn)) {
  fail('balanced is text-first; an image upload here means the contract moved without DL-002 being revisited');
}
includes(schemas, 'image_path: z.string().min(1).nullable()', 'contract allows "no image stored yet"');

// B4.8.3 — a soft UI prompt is not enforcement. The server owns the active
// device state and every write path must prove the caller is still active.
includes(deviceSql, 'create table if not exists public.user_devices', 'device policy table exists');
includes(deviceSql, 'user_devices_one_active_per_user_idx', 'only one active device can exist');
includes(deviceSql, 'function public.claim_user_device', 'claim RPC exists');
includes(deviceSql, "'takeover_required'", 'claim asks before takeover');
includes(deviceSql, 'function public.assert_active_device', 'edge enforcement RPC exists');
includes(deviceSql, 'grant execute on function public.assert_active_device(uuid, uuid) to service_role', 'only edge functions can assert active device');
includes(deviceClient, "SecureStore.getItemAsync(DEVICE_ID_KEY)", 'installation ID survives app restarts');
includes(deviceClient, 'crypto.getRandomValues(bytes)', 'installation ID is random');
includes(authContext, "supabase.rpc('claim_user_device'", 'login claims current device');
includes(authContext, "p_takeover: true", 'takeover needs an explicit choice');
includes(authContext, 'void syncFromServer(currentSession.user.id', 'receipt pull begins only after claim succeeds');
includes(receiptClient, "'x-rf-device-id': deviceId", 'all receipt clients send installation ID');
for (const [name, source] of [
  ['precise extract', fn],
  ['balanced extract', balancedFn],
  ['receipt confirmation', confirmFn],
  ['capture metrics', metricsFn],
]) {
  includes(source, "isActiveDevice(admin", `${name} checks active device`);
  includes(source, "code: 'DEVICE_INACTIVE'", `${name} refuses displaced device`);
  includes(source, 'x-rf-device-id', `${name} permits device header through CORS`);
}

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
// Rewritten by DL-007: the tiers are Pro/Max, four store products grant each,
// and the allowance is a property of the tier rather than of a product id. The
// invariant B4 cares about is unchanged — ONE pure rule, shared by both sides,
// with neither inventing its own arithmetic.
includes(contractsQuota, 'MONTHLY_SCAN_CAP', 'the cap comes from the product catalogue');
includes(contractsQuota, "from './products'", 'the quota rule resolves tiers through the catalogue');
includes(products, 'export const tiers = [', 'the catalogue defines the tiers');
includes(products, 'export function productId(', 'product ids are generated from one rule');
includes(contractsQuota, 'export function decideQuota', 'quota rule is one pure function');
// Imported from Deno, where extensionless relative imports do not resolve.
//
// The rule used to be "this file imports nothing", which held only while every
// contract was a single self-contained file. B8 split the product catalogue out
// of the quota rule and broke it silently: the app typechecked and the mirror
// looked fine, but no edge function could have booted. contracts:sync now
// rewrites relative specifiers to carry .ts, so what is asserted is the property
// that actually matters — the MIRROR Deno loads must have no bare or
// extensionless relative import left in it.
excludesPattern(contractsQuota, /from\s+['"]\w[^'"]*['"]/, 'contracts quota rule must not import a bare specifier');
excludesPattern(
  read('supabase/functions/_shared/contracts/quota.ts'),
  /from\s+['"]\.\.?\/[^'"]*(?<!\.ts)['"]/,
  'the mirrored quota rule must carry .ts on every relative import',
);

includes(quotaModule, "from './contracts/quota.ts'", 'server quota defers to the shared rule');

// The decision and the debit have to happen in one transaction, so the
// arithmetic lives in SQL and contracts/quota.ts is the client's advisory copy.
// Nothing else pins the two together — these assertions do.
includes(canScanSql, 'function public.can_scan', 'can_scan exists as a database function');
includes(canScanSql, 'from public.profiles p where p.id = p_user_id for update', 'can_scan locks the user row');
// PERFORM matching no row locks nothing and raises nothing, so a user without a
// profiles row would run the whole function unserialised — silently.
includes(canScanSql, 'if not found then', 'can_scan refuses when there is no row to lock');
includes(canScanSql, 'get diagnostics v_charged = row_count', 'a redelivered capture must not move the counter');
includes(canScanSql, 'v_plus_cap       constant int  := 500', 'SQL Plus cap matches the shared rule');
includes(canScanSql, "v_plus_product   constant text := 'rf_plus_699_m'", 'SQL Plus product id matches');
includes(canScanSql, "v_unlim_product  constant text := 'rf_unlimited_1199_m'", 'SQL Unlimited product id matches');
includes(canScanSql, 'v_burst_per_min  constant int  := 12', 'per-user burst limit is 12/min');
includes(canScanSql, 'current_period_start', 'quota counts from the subscription period start');
includes(canScanSql, "status in ('active', 'grace')", 'grace counts as active for quota');
includes(canScanSql, 'on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing', 'debit is idempotent on a redelivered capture');
// Outputs must never share a name with a column they sit alongside in a query.
excludesPattern(canScanSql, /returns table \(allowed /, 'can_scan outputs must not shadow column names');
includes(canScanSql, 'grant execute on function public.can_scan(uuid, uuid) to service_role', 'can_scan is service-role only');
excludesPattern(canScanSql, /grant execute on function public\.can_scan\(uuid, uuid\) to authenticated/, 'can_scan must not be callable by users directly');
includes(refundSql, 'grant execute on function public.refund_scan(uuid, uuid) to service_role', 'refund_scan is service-role only');
excludesPattern(refundSql, /grant execute on function public\.refund_scan\(uuid, uuid\) to authenticated/, 'refund_scan must not be callable by users directly');

includes(quotaModule, "client.rpc('can_scan'", 'server quota decides through the atomic function');
includes(quotaModule, "client.rpc('refund_scan'", 'server quota can give a scan back');

// The scan is charged before the model runs, and only an explicit is_receipt:false
// refunds it. So a *missing* verdict must not read as "receipt" — that turned a
// model omission into a charge the user never got back.
excludes(fn, 'r.is_receipt !== false', 'precise must not default a missing is_receipt to true');
excludes(balancedFn, 'r.is_receipt !== false', 'balanced must not default a missing is_receipt to true');
includes(fn, "typeof r.is_receipt === 'boolean' ? r.is_receipt : null", 'precise honours only an explicit verdict');
includes(balancedFn, "typeof r.is_receipt === 'boolean' ? r.is_receipt : null", 'balanced honours only an explicit verdict');

// An order list extracts seven named items and not one amount among them, so
// item count proves nothing. No money anywhere means nothing usable was
// produced, and the scan goes back — an explicit "receipt" does not override it.
includes(fn, 'total > 0 || items.some((item) => item.amount > 0)', 'precise requires at least one amount');
includes(balancedFn, 'total > 0 || items.some((item) => item.amount > 0)', 'balanced requires at least one amount');
includes(fn, 'hasValue && claimed !== false', 'precise cannot save a receipt worth nothing');
includes(balancedFn, 'hasValue && claimed !== false', 'balanced cannot save a receipt worth nothing');

// Refunding at each return site is how three of them got missed. One flag, one
// finally: anything that is not a delivered receipt gives the scan back.
includes(balancedFn, 'if (refundCharge && !billable)', 'balanced refunds every non-billable exit');
includes(fn, 'if (charge.refund && !charge.billable)', 'precise refunds every non-billable exit');
includes(fn, "code: 'RATE_LIMITED'", 'precise returns 429 when the burst limit is hit');
includes(balancedFn, "code: 'RATE_LIMITED'", 'balanced returns 429 when the burst limit is hit');
includes(fn, 'evaluateQuota(admin, userId, captureId)', 'precise charges under the capture id');
includes(balancedFn, 'evaluateQuota(admin, userId, captureId)', 'balanced charges under the capture id');
includes(balancedFn, 'refundScan(admin, userId, captureId)', 'balanced gives back a rejected scan');
includes(fn, "from '../_shared/quota.ts'", 'precise uses the shared quota module');
includes(balancedFn, "from '../_shared/quota.ts'", 'balanced uses the shared quota module');
excludes(fn, 'parse_pro_m', 'precise must not re-implement product tiers');
excludes(balancedFn, 'parse_pro_m', 'balanced must not re-implement product tiers');
excludes(quotaModule, 'MONTHLY_SCAN_CAP =', 'server must not re-declare the cap');

// The balance rides back on a call the client already made, so the cached
// figure refreshes without a second request.
includes(fn, 'scans_remaining:', 'precise reports the remaining balance');
includes(balancedFn, 'scans_remaining:', 'balanced reports the remaining balance');

includes(balancedFn, 'evaluateQuota(admin, userId, captureId)', 'balanced runs can_scan');
includes(balancedFn, 'if (!quota.canScan)', 'balanced enforces the quota verdict');
includes(balancedFn, "code: 'QUOTA_EXHAUSTED'", 'balanced quota exhausted response');
// The debit now happens inside can_scan(), before the model runs, so neither
// function may write the ledger directly — that was the window in which two
// parallel captures could both spend the last scan.
excludes(balancedFn, "reason: 'scan_used'", 'balanced must not debit outside can_scan');
excludes(fn, "reason: 'scan_used'", 'precise must not debit outside can_scan');
// Both anchors live in the request handler, so source order is execution order:
// the verdict is checked, and an exhausted account returns, before anything is
// persisted or charged.
order(balancedFn, 'evaluateQuota(admin, userId, captureId)', 'if (!quota.canScan)', 'quota verdict is awaited before use');
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
includes(confirmFn, 'p_merchant: patch.merchant', 'confirm writes the field patch, not just a status');
excludesPattern(confirmFn, /\.update\(\{\s*status:\s*'confirmed',\s*confirmed_via:\s*'user'\s*\}\)/, 'confirm must not go back to writing only a status');

console.log('[b4:backend] Grok fast path, balanced fast path, shared quota, validation, and ack-gate source checks passed');
