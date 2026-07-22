const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(`[b3:app] ${message}`);
}

function includes(source, needle, label) {
  if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`);
}

function order(source, before, after, label) {
  const a = source.indexOf(before);
  const b = source.indexOf(after);
  if (a === -1 || b === -1 || a > b) fail(`${label}: expected ${JSON.stringify(before)} before ${JSON.stringify(after)}`);
}

const capture = read('src/lib/receipts/capture.ts');
const store = read('src/lib/receipts/store.ts');
const camera = read('src/app/camera.tsx');
const types = read('src/lib/receipts/types.ts');
const client = read('src/lib/receipts/client.ts');

includes(capture, 'const TARGET_LONG_EDGE = 1024', 'T3.1 long-edge target');
includes(capture, 'SaveFormat.JPEG', 'T3.1 JPEG output');
includes(capture, 'compress: JPEG_QUALITY', 'T3.1 JPEG quality');
includes(capture, 'detectAndCorrect(photoUri)', 'T3.1 EXIF/document correction path');
includes(capture, 'FileSystem.documentDirectory', 'T3.5 durable app document storage');
includes(capture, 'persistCaptureFile(compressed, captureId)', 'T3.5 bytes outside SQLite');

includes(types, "export type CaptureMode = 'default' | 'one_click'", 'T3.2 capture mode type');
includes(store, 'capture_mode TEXT', 'T3.2 queue mode column');
includes(store, 'attempts   INTEGER', 'T3.5 attempts column');
includes(store, 'next_retry_at INTEGER', 'T3.5 retry timestamp column');
includes(store, 'receipt_id TEXT', 'T3.4 server receipt id column');
includes(store, 'acked_at INTEGER', 'T3.5 ack timestamp column');
includes(store, 'newCaptureId', 'T3.2 unique capture ids');

includes(camera, "processCapture(photo.uri, toCaptureMode(mode)", 'T3.2 camera captures enqueue selected mode');
includes(camera, "processCapture(uri, 'default')", 'T3.2 gallery default mode');
includes(camera, "processCapture(uri, 'one_click')", 'T3.2 gallery one-click mode');
includes(camera, 'Network.addNetworkStateListener', 'T3.3 reconnect listener');
includes(camera, 'void retryPending();', 'T3.3 retry on mount/reconnect');

includes(capture, 'let dispatchInFlight', 'T3.4 single-flight lock');
includes(capture, 'if (dispatchInFlight) return dispatchInFlight', 'T3.4 duplicate dispatcher guard');
includes(capture, 'Math.min(MAX_BACKOFF_MS', 'T3.5 bounded backoff');
includes(capture, 'await store.markRetry(row.id, attempts', 'T3.5 retry bookkeeping');
includes(
  capture,
  "await store.markDispatched(row.id, ack.receiptId, fields);\n    await deleteLocalFile(durableImageUri);",
  'T3.5 delete after capture ack',
);
includes(
  capture,
  "await store.markDispatched(row.id, ack.receiptId, toReceiptFields(ack.response));\n      await deleteLocalFile(row.imageUri);",
  'T3.5 delete after retry ack',
);

includes(client, 'getFoundationEnv().mockBackend ? mockExtractClient : supabaseExtractClient', 'integration mock backend switch');
includes(client, "/functions/v1/extract", 'integration real extract endpoint');
includes(client, 'Authorization: `Bearer ${accessToken}`', 'integration user auth header');
includes(client, 'apikey: env.supabaseAnonKey', 'integration anon apikey header');

console.log('[b3:app] T3.1/T3.2/T3.3/T3.5 client source checks passed');
