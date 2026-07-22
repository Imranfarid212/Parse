/**
 * The capture pipeline: photo → ~1024px JPEG → POST /extract → normalized
 * fields, with every step landing in the local store first.
 *
 * The contract (HANDOFF §5) says the front end compresses to ~1024px JPEG
 * (~120 KB) before POSTing — output tokens dominate cost, and the vision
 * models read faded thermal print fine at that size.
 */
import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import { detectAndCorrect } from '@/../modules/document-scan';
import { extractClient, toReceiptFields } from '@/lib/receipts/client';
import * as store from '@/lib/receipts/store';
import { isNotAReceipt, type CaptureMode, type ReceiptFields, type ReceiptRow } from '@/lib/receipts/types';

/** Contract: ~1024px on the long edge, JPEG. */
const TARGET_LONG_EDGE = 1024;
const JPEG_QUALITY = 0.7;
const CAPTURE_DIR = `${FileSystem.documentDirectory ?? ''}captures/`;
const MAX_BACKOFF_MS = 60_000;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

export async function compressForUpload(uri: string): Promise<string> {
  // Contextual API — `manipulateAsync` is deprecated in SDK 57.
  const { width, height } = await getImageSize(uri);
  const longEdge = Math.max(width, height);
  const ctx = ImageManipulator.manipulate(uri);

  if (longEdge > TARGET_LONG_EDGE) {
    ctx.resize(width >= height ? { width: TARGET_LONG_EDGE } : { height: TARGET_LONG_EDGE });
  }

  const rendered = await ctx.renderAsync();
  const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return out.uri;
}

async function persistCaptureFile(uri: string, captureId: string): Promise<string> {
  if (!FileSystem.documentDirectory) return uri;
  await FileSystem.makeDirectoryAsync(CAPTURE_DIR, { intermediates: true });
  const target = `${CAPTURE_DIR}${captureId}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

async function deleteLocalFile(uri: string): Promise<void> {
  if (!uri.startsWith(CAPTURE_DIR)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

const nextBackoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
}

export type CaptureOutcome =
  | { kind: 'extracted'; row: ReceiptRow; fields: ReceiptFields }
  /** Contract's one specified error: show the notice, stay on camera. */
  | { kind: 'not_a_receipt'; row: ReceiptRow }
  /** Anything else. The row stays `pending_extract` and the queue retries it. */
  | { kind: 'queued'; row: ReceiptRow; reason?: string };

/**
 * Runs a captured photo through the pipeline. Never throws for transport
 * failures — those become `queued`, because the image is already saved and the
 * retry queue owns it from there.
 */
let dispatchInFlight: Promise<number> | null = null;

export async function processCapture(
  photoUri: string,
  captureMode: CaptureMode = 'default',
  signal?: AbortSignal,
): Promise<CaptureOutcome> {
  // Deskew + crop to the document before compressing (iOS; null elsewhere or
  // when no page is found — then the original frame proceeds untouched). A
  // flattened page at 1024px spends its pixels on print, not table.
  const corrected = await detectAndCorrect(photoUri);
  if (__DEV__) {
    // The mock /extract gives the deskew no visible surface in the UI yet, so
    // this Metro line is the way to verify it fired on a real device.
    console.log(
      corrected
        ? `[document-scan] page found (confidence ${corrected.confidence.toFixed(2)}) → ${corrected.uri}`
        : '[document-scan] no page found — using original frame',
    );
  }
  const compressed = await compressForUpload(corrected?.uri ?? photoUri);
  const captureId = store.newCaptureId();
  const durableImageUri = await persistCaptureFile(compressed, captureId);
  // The row exists before the network is touched, so a crash/kill mid-request
  // still leaves the scan recoverable.
  const row = await store.insertCaptured(durableImageUri, captureMode, captureId);

  try {
    const ack = await extractClient.extract({
      captureId: row.id,
      imageUri: durableImageUri,
      mode: row.captureMode,
      capturedAt: new Date(row.createdAt).toISOString(),
      signal,
    });
    if (isNotAReceipt(ack.response)) {
      // Not a receipt is a verdict, not a failure — don't leave it queued.
      await store.remove(row.id);
      await deleteLocalFile(durableImageUri);
      return { kind: 'not_a_receipt', row };
    }

    const fields = toReceiptFields(ack.response);
    await store.markDispatched(row.id, ack.receiptId, fields);
    await deleteLocalFile(durableImageUri);
    return { kind: 'extracted', row: { ...row, fields, receiptId: ack.receiptId, status: 'extracted' }, fields };
  } catch (error) {
    const reason = describeError(error);
    if (__DEV__) console.warn('[capture] extract queued', reason);
    await store.markRetry(row.id, 1, Date.now() + nextBackoffMs(1));
    return { kind: 'queued', row, reason: __DEV__ ? reason : undefined };
  }
}

/** Swipe-up (or One-click's auto-confirm). Optimistic: local write, then sync. */
export async function confirm(id: string, fields: ReceiptFields): Promise<void> {
  await store.setFields(id, fields, 'confirmed_local');
  void syncConfirmed();
}

/**
 * Push locally-confirmed rows to the server. No-op until /extract's sibling
 * write endpoint exists — rows simply stay `confirmed_local`, which is exactly
 * what we want them to do until there's somewhere to send them.
 */
export async function syncConfirmed(): Promise<void> {
  // TODO(backend): POST each row, then store.setStatus(row.id, 'synced').
}

/**
 * Re-drive scans whose extraction never landed. Called on reconnect.
 * Returns how many rows advanced past `pending_extract`.
 */
export async function retryPending(): Promise<number> {
  if (dispatchInFlight) return dispatchInFlight;
  dispatchInFlight = dispatchPending().finally(() => {
    dispatchInFlight = null;
  });
  return dispatchInFlight;
}

async function dispatchPending(): Promise<number> {
  const pending = await store.listPendingExtract();
  let recovered = 0;

  for (const row of pending) {
    try {
      const ack = await extractClient.extract({
        captureId: row.id,
        imageUri: row.imageUri,
        mode: row.captureMode,
        capturedAt: new Date(row.createdAt).toISOString(),
      });
      if (isNotAReceipt(ack.response)) {
        await store.remove(row.id);
        await deleteLocalFile(row.imageUri);
        continue;
      }
      await store.markDispatched(row.id, ack.receiptId, toReceiptFields(ack.response));
      await deleteLocalFile(row.imageUri);
      recovered += 1;
    } catch (error) {
      if (__DEV__) console.warn('[capture] retry queued', describeError(error));
      const attempts = row.attempts + 1;
      await store.markRetry(row.id, attempts, Date.now() + nextBackoffMs(attempts));
      // Still unreachable — leave it queued for the next reconnect.
      break;
    }
  }

  return recovered;
}
