const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b4:app] ${message}`);
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

includes(quota, "from '@/../packages/contracts/src/quota'", 'client uses the shared quota rule');
includes(quota, 'decideQuota(', 'client decides with the shared rule');
if (/PLUS_MONTHLY_CAP\s*=|rf_plus_699_m'\s*;|=\s*500\b/.test(quota)) {
  fail('client must not re-implement the quota arithmetic; import it from contracts');
}
includes(quota, 'export async function checkQuotaGate', 'shutter gate helper');
includes(quota, 'export async function applyServerQuota', 'server balance refreshes the cache');
includes(camera, 'await passesQuotaGate()', 'capture paths run the gate');
includes(capture, 'applyServerQuota(options?.userId', 'extract responses refresh the cached balance');

console.log('[b4:app] rejected/non-receipt UX and secret-boundary checks passed');
