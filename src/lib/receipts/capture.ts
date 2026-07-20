/**
 * The capture pipeline: photo → ~1024px JPEG → POST /extract → normalized
 * fields, with every step landing in the local store first.
 *
 * The contract (HANDOFF §5) says the front end compresses to ~1024px JPEG
 * (~120 KB) before POSTing — output tokens dominate cost, and the vision
 * models read faded thermal print fine at that size.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { detectAndCorrect } from '@/../modules/document-scan';
import { extractClient, toReceiptFields } from '@/lib/receipts/client';
import * as store from '@/lib/receipts/store';
import { isNotAReceipt, type ReceiptFields, type ReceiptRow } from '@/lib/receipts/types';

/** Contract: ~1024px on the long edge, JPEG. */
const TARGET_WIDTH = 1024;
const JPEG_QUALITY = 0.7;

export async function compressForUpload(uri: string): Promise<string> {
  // Contextual API — `manipulateAsync` is deprecated in SDK 57.
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: TARGET_WIDTH });
  const rendered = await ctx.renderAsync();
  const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return out.uri;
}

export type CaptureOutcome =
  | { kind: 'extracted'; row: ReceiptRow; fields: ReceiptFields }
  /** Contract's one specified error: show the notice, stay on camera. */
  | { kind: 'not_a_receipt'; row: ReceiptRow }
  /** Anything else. The row stays `pending_extract` and the queue retries it. */
  | { kind: 'queued'; row: ReceiptRow };

/**
 * Runs a captured photo through the pipeline. Never throws for transport
 * failures — those become `queued`, because the image is already saved and the
 * retry queue owns it from there.
 */
export async function processCapture(photoUri: string, signal?: AbortSignal): Promise<CaptureOutcome> {
  // Deskew + crop to the document before compressing (iOS; null elsewhere or
  // when no page is found — then the original frame proceeds untouched). A
  // flattened page at 1024px spends its pixels on print, not table.
  const corrected = await detectAndCorrect(photoUri);
  const compressed = await compressForUpload(corrected?.uri ?? photoUri);
  // The row exists before the network is touched, so a crash/kill mid-request
  // still leaves the scan recoverable.
  const row = await store.insertCaptured(compressed);

  try {
    const res = await extractClient.extract(compressed, signal);

    if (isNotAReceipt(res)) {
      // Not a receipt is a verdict, not a failure — don't leave it queued.
      await store.remove(row.id);
      return { kind: 'not_a_receipt', row };
    }

    const fields = toReceiptFields(res);
    await store.setFields(row.id, fields, 'extracted');
    return { kind: 'extracted', row: { ...row, fields, status: 'extracted' }, fields };
  } catch {
    return { kind: 'queued', row };
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
  const pending = await store.listPendingExtract();
  let recovered = 0;

  for (const row of pending) {
    try {
      const res = await extractClient.extract(row.imageUri);
      if (isNotAReceipt(res)) {
        await store.remove(row.id);
        continue;
      }
      await store.setFields(row.id, toReceiptFields(res), 'extracted');
      recovered += 1;
    } catch {
      // Still unreachable — leave it queued for the next reconnect.
      break;
    }
  }

  return recovered;
}
