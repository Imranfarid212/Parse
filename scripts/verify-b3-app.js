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
// Where a failed image backup has to become visible — see the T3.5 block below.
const search = read('src/components/search/SearchView.tsx');

// T3.1 specifies a ceiling (≤1080 px), not one exact value — B4 tuned this down
// to 640 for latency, which the old equality check read as a regression.
const longEdge = Number(capture.match(/const TARGET_LONG_EDGE = (\d+)/)?.[1]);
if (!Number.isFinite(longEdge)) fail('T3.1 long-edge target: TARGET_LONG_EDGE not found');
if (longEdge > 1080) fail(`T3.1 long-edge target: ${longEdge}px exceeds the 1080px ceiling`);
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
// Trailing paren dropped: B4 added the extraction-mode argument to these calls.
includes(camera, "processCapture(uri, 'default'", 'T3.2 gallery default mode');
// One-click no longer calls processCapture inline: it is detached from the
// shutter so shots do not block each other, and both entry points share
// runDetachedCapture, which passes the mode through. Same capability, one call
// site instead of two.
includes(camera, 'void runDetachedCapture(uri, toCaptureMode(mode)', 'T3.2 gallery one-click mode');
includes(camera, 'Network.addNetworkStateListener', 'T3.3 reconnect listener');
includes(camera, 'void retryPending();', 'T3.3 retry on mount/reconnect');

includes(capture, 'let dispatchInFlight', 'T3.4 single-flight lock');
includes(capture, 'if (dispatchInFlight) return dispatchInFlight', 'T3.4 duplicate dispatcher guard');
includes(capture, 'Math.min(MAX_BACKOFF_MS', 'T3.5 bounded backoff');
includes(capture, 'await store.markRetry(row.id, attempts', 'T3.5 retry bookkeeping');
/**
 * T3.5 — the local photo is released only once a durable copy exists.
 *
 * These two checks used to require deletion immediately after the extraction
 * ack, which was right when B3 was photo-first: the server had already stored
 * the image before it replied, so the ack was proof of durability.
 *
 * DL-002 changed what the ack means. On the Balanced path the server never
 * receives the image, so the ack proves only that extraction finished. The
 * durable copy now arrives later, through the background backup, and the rule
 * that carries the original safety property is: delete when, and only when,
 * imageSyncStatus reaches 'uploaded'.
 *
 * So these are rewritten, not restored. The old assertions were correct to
 * fail — they were describing a design that no longer exists.
 */
includes(
  capture,
  "if (imageSyncStatus === 'pending_upload') void durableImagePromise?.then(() => syncImageBackups());",
  'T3.5 a text-first ack queues the backup instead of releasing the photo',
);
includes(
  capture,
  "await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });\n      await deleteLocalFile(durableImageUri);",
  'T3.5 delete only once the image is marked uploaded',
);
includes(
  capture,
  "await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });\n      await deleteLocalFile(row.imageUri);",
  'T3.5 the background backup deletes only after a confirmed upload',
);
/**
 * The other half of the amended rule: if the upload never succeeds, the photo
 * is still on the device and the user has to be able to see that and act on it.
 * Under the old rule this could not arise — the server had the image before the
 * ack — so nothing was ever built for it, and upload_failed_final was written
 * in one place and read in none.
 */
includes(capture, 'export async function retryFailedImageUpload', 'T3.5 a failed upload can be retried');
includes(search, "row.imageSyncStatus === 'upload_failed_final'", 'T3.5 a failed upload is visible to the user');
includes(search, "row.imageSyncStatus === 'missing_local_file'", 'T3.5 an unavailable photo is visible rather than looking saved');
includes(search, 'IMAGE_BACKUP_IN_FLIGHT', 'T3.5 Recents refreshes while a photo backup is running');
includes(client, "EXPO_PUBLIC_FORCE_IMAGE_BACKUP_FAILURE === '1'", 'T3.5 development drill can force only the image backup to fail');
includes(capture, 'function scheduleImageBackupRetry', 'T3.5 a reachable app schedules the next image backup attempt');
includes(capture, 'scheduleImageBackupRetry(nextRetryAt)', 'T3.5 a failed image backup actually queues its next attempt');

includes(client, 'getFoundationEnv().mockBackend ? mockExtractClient : supabaseExtractClient', 'integration mock backend switch');
includes(client, "/functions/v1/extract", 'integration real extract endpoint');
includes(client, 'Authorization: `Bearer ${accessToken}`', 'integration user auth header');
includes(client, 'apikey: env.supabaseAnonKey', 'integration anon apikey header');

console.log('[b3:app] T3.1/T3.2/T3.3/T3.5 client source checks passed');
