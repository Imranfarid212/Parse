const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b4:app] ${message}`);
}

/** Asserts `before` appears ahead of `after` — used for control-flow ordering. */
function order(source, before, after, label) {
  const a = source.indexOf(before);
  const b = source.indexOf(after);
  if (a === -1 || b === -1 || a > b) fail(`${label}: expected ${JSON.stringify(before)} before ${JSON.stringify(after)}`);
}

function includes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
}

const client = read('src/lib/receipts/client.ts');
const capture = read('src/lib/receipts/capture.ts');
const env = read('src/lib/foundations/env.ts');
const envExample = read('.env.example');

includes(client, 'rejected?: boolean', 'wire rejected flag typed');
includes(client, 'duplicate?: boolean', 'wire duplicate flag typed');
includes(client, 'timing?: {', 'wire timing metrics typed');
includes(client, "console.log('[extract] completed'", 'extract timing logged in dev');
includes(client, "response: { error: 'not_a_receipt' }", 'non-receipt maps to existing UX outcome');
includes(client, "response: { error: 'duplicate_receipt' }", 'duplicate maps to existing UX outcome');
includes(client, "category: data.result?.suggested_category ?? 'Miscellaneous'", 'category fallback still guarded app-side');
includes(client, "/functions/v1/receipt-confirm", 'server confirm endpoint wired');
includes(client, "confirmReceiptClient: ConfirmReceiptClient", 'confirm client selection');
includes(capture, "return { kind: 'not_a_receipt', row }", 'non-receipt outcome');
includes(capture, "return { kind: 'duplicate', row }", 'duplicate outcome');
includes(capture, "await deleteLocalFile(durableImageUri);", 'capture file deletion after terminal outcome');
includes(capture, "await store.markDispatched(row.id, ack.receiptId, fields);", 'default extracted review path');
includes(capture, "await confirmReceiptClient.confirm({ receiptId: row.receiptId, fields: row.fields });", 'confirmed rows sync to server');
includes(capture, "await store.setStatus(row.id, 'synced');", 'server-confirmed rows leave local sync queue');
includes(capture, 'await store.markRetry(row.id, 1', 'transport failure stays queued');
includes(capture, "isDuplicateReceipt(ack.response)", 'duplicate rows leave local queue');
includes(env, 'EXPO_PUBLIC_MOCK_BACKEND', 'Expo public mock switch only');
includes(envExample, 'XAI_API_KEY=dummy', 'dummy Grok key lives in env example');
includes(envExample, 'SUPABASE_SERVICE_ROLE_KEY=', 'service key example is server-only');

if (/EXPO_PUBLIC_.*XAI|EXPO_PUBLIC_.*GROK|sk-[A-Za-z0-9]/.test(client + capture + env)) {
  fail('provider secret must not be exposed to the app bundle or hardcoded');
}

// Client-side quota gate: stops an out-of-scans user at the shutter, before the
// photo, the upload and the model. Advisory only — the server still enforces.
const quota = read('src/lib/receipts/quota.ts');
const camera = read('src/app/camera.tsx');
const search = read('src/components/search/SearchView.tsx');

includes(quota, "from '@/../packages/contracts/src/quota'", 'client uses the shared quota rule');
includes(quota, 'decideQuota(', 'client decides with the shared rule');
if (/PLUS_MONTHLY_CAP\s*=|rf_plus_699_m'\s*;|=\s*500\b/.test(quota)) {
  fail('client must not re-implement the quota arithmetic; import it from contracts');
}
includes(quota, 'export async function checkQuotaGate', 'shutter gate helper');
includes(quota, 'export async function applyServerQuota', 'server balance refreshes the cache');
includes(camera, 'await passesQuotaGate()', 'capture paths run the gate');
includes(capture, 'applyServerQuota(options?.userId', 'extract responses refresh the cached balance');
includes(
  camera,
  "if (out.row.extractionMode === 'precise') {\n          uploadCaptureMetrics({",
  'default Precise captures upload latency metrics',
);

// A rate limit is "not now", not "not ever". The server answers 429 rather than
// 402 precisely so the capture retries — but the client ignored retry_after_s
// and spent one of five attempts per refusal, so a throttled scan could reach
// llm_failed_final in under fifteen seconds over a window that clears in sixty.
includes(capture, "getExtractErrorCode(error) !== 'RATE_LIMITED'", 'a throttle is told apart from a failure');
includes(capture, 'throttleRetryMs(error)', 'the retry path asks how long the server said to wait');
includes(client, 'export function getExtractRetryAfterMs', 'the 429 wait reaches the retry path');
includes(client, 'error.retryAfterS = data?.retry_after_s', 'retry_after_s is carried on the error');
// The attempt count is passed through unchanged and the branch exits before the
// increment, so a throttle can never walk the row to llm_failed_final.
includes(capture, 'markRetry(row.id, row.attempts, Date.now() + throttleMs)', 'a throttle does not spend an attempt');
order(capture, 'if (throttleMs != null) {', 'if (attempts >= MAX_EXTRACT_ATTEMPTS)', 'the throttle branch exits before the failure budget');

// T4.5 needs five rapid One-click scans. The shutter used to be held until the
// model answered and every capture aborted the one before it, so the burst limit
// guarded a rate the UI could not reach.
includes(camera, 'releaseShutter();', 'the shutter is freed as soon as the photo exists');
includes(camera, 'detachedAborts.current.add(detachedAc)', 'each detached capture carries its own controller');
order(camera, 'releaseShutter();', 'void runDetachedCapture(', 'the shutter is freed before the scan runs');
// Precise joins One-click: it shows no card, and it has just said it finishes in
// the background, so holding the shutter contradicts what the user was told.
includes(camera, "if (mode !== 'default' || extractionMode === 'precise') {", 'Precise is detached too, not just One-click');
if (/void runDetachedCapture\([\s\S]{0,200}abortRef/.test(camera)) {
  fail('detached captures must not share abortRef; a new shot would cancel the previous one');
}
// The race existed only to release a blocked UI. Nothing blocks now.
if (/waitForVisibleDeadline/.test(camera)) fail('the visible-deadline race has no job left once nothing is held');

// A quota rejection used to delete the row and the photo. That was defensible
// only while it could not happen without the user watching — offline capture
// removed that, so a receipt photographed offline was destroyed the moment
// connectivity returned on an exhausted account, with nothing shown at any
// point. It is kept and listed as blocked now, and never auto-retried.
includes(capture, "markFinalFailure(row.id, 'blocked_quota')", 'a quota rejection blocks the capture rather than deleting it');
if (/QUOTA_EXHAUSTED'\)\s*\{[\s\S]{0,400}?deleteLocalFile/.test(capture)) {
  fail("a quota rejection must not delete the user's photo");
}
includes(capture, 'export async function retryBlockedCapture', 'a blocked capture can be handed back to the queue');
includes(capture, 'export async function purgeAbandonedCaptures', 'kept photos expire instead of accumulating forever');
includes(search, "blocked_quota: 'Out of scans'", 'a blocked capture is labelled, not silently absent');
includes(search, 'retryBlockedCapture(id)', 'the list offers a way back');
// listRecent hides pending_extract, so requeueing to it makes the row vanish
// from Search the moment the user asks to retry it.
includes(read('src/lib/receipts/store.ts'), "SET status = 'llm_failed_retryable', attempts = 0", 'a retried capture stays visible while it runs');
if (/'blocked_quota'/.test(read('src/lib/receipts/store.ts').match(/listPendingExtract[\s\S]{0,400}/)?.[0] ?? '')) {
  fail('blocked captures must stay out of the retry queue; retrying cannot conjure scans');
}

// 4.3: Precise promises the background workflow once, up front, and shows no
// spinner — there is nothing on screen for the user to wait on. Announcing it at
// preflight was unsafe while quota could still be refused afterwards; it is not
// now, because the shutter gate catches that before a photo is taken.
includes(camera, 'onPrecisePreflightAccepted: showPreciseUpFrontNotice', 'Precise says what will happen before it happens');
if (/k: 'working'/.test(camera)) fail('the Precise spinner phase is scaffolding and should be gone');
// Anything landing after that dialog is news, not a decision — a modal there is
// the second dialog the up-front notice exists to prevent.
includes(camera, 'if (late) flashNotice(LATE_NOT_A_RECEIPT_TOAST)', 'a late rejection is a toast, not a dialog');
includes(camera, 'if (late) flashNotice(LATE_QUOTA_TOAST)', 'a late quota refusal is a toast, not a dialog');

console.log('[b4:app] rejected/non-receipt UX and secret-boundary checks passed');
