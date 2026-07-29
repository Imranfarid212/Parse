/**
 * The capture pipeline: photo → compact JPEG → POST /extract → normalized
 * fields, with every step landing in the local store first.
 *
 * B4 latency test: keep the receipt legible but smaller so upload and model
 * vision work have less payload to chew through.
 */
import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import { detectAndCorrect, recognizeText } from '@/../modules/document-scan';
import {
  captureMetricsClient,
  confirmReceiptClient,
  extractClient,
  getCaptureAttempts,
  imageBackupClient,
  toReceiptFields,
  type CaptureMetricsPayload,
  type CaptureAttemptTrace,
  type ExtractAck,
  type ExtractVisibleDeadlineAck,
} from '@/lib/receipts/client';
import * as store from '@/lib/receipts/store';
import {
  isDuplicateReceipt,
  isNotAReceipt,
  isCategory,
  type CaptureMode,
  type Category,
  type DuplicateCandidate,
  type ExtractionMode,
  type ReceiptFields,
  type ReceiptRow,
} from '@/lib/receipts/types';

/** B4 latency test: 640px long edge, lower JPEG quality. */
const TARGET_LONG_EDGE = 640;
const JPEG_QUALITY = 0.55;
const OCR_TARGET_LONG_EDGE = 1600;
const OCR_JPEG_QUALITY = 0.9;
const OCR_TIMEOUT_MS = 2500;
const CAPTURE_DIR = `${FileSystem.documentDirectory ?? ''}captures/`;
const MAX_BACKOFF_MS = 60_000;
const MAX_EXTRACT_ATTEMPTS = 5;
const MAX_IMAGE_BACKUP_ATTEMPTS = 5;
const MAX_CONFIRM_SYNC_ATTEMPTS = 5;
const VISIBLE_DEADLINE_RETRY_DELAY_MS = 15_000;
const DRAFT_CATEGORY: Category = 'Miscellaneous';

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

async function prepareForOcr(uri: string): Promise<{ uri: string; width: number; height: number; resized: boolean }> {
  const { width, height } = await getImageSize(uri);
  const longEdge = Math.max(width, height);
  if (longEdge <= OCR_TARGET_LONG_EDGE) {
    return { uri, width, height, resized: false };
  }

  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize(width >= height ? { width: OCR_TARGET_LONG_EDGE } : { height: OCR_TARGET_LONG_EDGE });
  const rendered = await ctx.renderAsync();
  const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: OCR_JPEG_QUALITY });
  const size = await getImageSize(out.uri);
  return { uri: out.uri, width: size.width, height: size.height, resized: true };
}

async function recognizeTextWithDeadline(uri: string, timeoutMs: number): Promise<{ text: string | null; timedOut: boolean }> {
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const ocrPromise = recognizeText(uri)
    .then((text) => {
      settled = true;
      if (timeout) clearTimeout(timeout);
      return text;
    })
    .catch((error) => {
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (__DEV__) console.warn('[capture] local OCR failed', describeError(error));
      return null;
    });
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      if (!settled) resolve(null);
    }, timeoutMs);
  });

  const text = await Promise.race([ocrPromise, timeoutPromise]);
  return { text, timedOut: !settled };
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

async function localFileExists(uri: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists;
}

const nextBackoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));
const nextBackoffWithJitterMs = (attempts: number) => {
  const base = nextBackoffMs(attempts);
  return Math.round(base * (0.75 + Math.random() * 0.5));
};

const isVisibleDeadlineAck = (ack: ExtractAck): ack is ExtractVisibleDeadlineAck =>
  'state' in ack && ack.state === 'visible_deadline';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
}

function inferCurrencyFromText(text: string, defaultCurrency: string): string {
  const lower = text.toLowerCase();
  if (/[₹]|(?:\brs\.?\b)|\binr\b|\bgst\b|\bbengal(?:uru|ore)\b|\bbangalore\b|\bindia\b/.test(lower)) return 'INR';
  if (/[€]|\beur\b|\bvat\b/.test(lower)) return 'EUR';
  if (/[£]|\bgbp\b|\buk\b|\blondon\b/.test(lower)) return 'GBP';
  if (/\busd\b|[$]/.test(lower)) return 'USD';
  return /^[A-Z]{3}$/.test(defaultCurrency) ? defaultCurrency : 'USD';
}

function parseDraftDate(text: string): string | null {
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const day = first > 12 ? first : second > 12 ? second : first;
  const month = first > 12 ? second : second > 12 ? first : second;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDraftMerchant(lines: string[]): string {
  const ignored = /\b(bill|invoice|receipt|date|time|item|qty|rate|amount|total|phone|tel|gst|tax|hdfc|bank|card|cash|upi|mc#)\b/i;
  const merchant = lines.find((line) => /[a-z]/i.test(line) && !ignored.test(line) && line.replace(/[^a-z]/gi, '').length >= 3);
  return merchant?.slice(0, 80) ?? '';
}

function draftFromOcr(text: string, defaultCurrency: string): ReceiptFields | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const store = parseDraftMerchant(lines);
  if (!store) return null;
  return {
    date: parseDraftDate(text),
    store,
    items: [],
    currency: inferCurrencyFromText(text, defaultCurrency),
    total: 0,
    category: isCategory(DRAFT_CATEGORY) ? DRAFT_CATEGORY : 'Miscellaneous',
    handwritten_notes: '',
  };
}

export type CaptureOutcome =
  | {
      kind: 'extracted';
      row: ReceiptRow;
      fields: ReceiptFields;
      metrics: CaptureMetricsPayload['metrics'];
      attempts?: CaptureAttemptTrace[];
      duplicateCandidate?: DuplicateCandidate | null;
    }
  /** Contract's one specified error: show the notice, stay on camera. */
  | { kind: 'not_a_receipt'; row: ReceiptRow }
  /** Same user already has this merchant/date/currency/total receipt. */
  | { kind: 'duplicate'; row: ReceiptRow }
  /** Anything else. The row stays `pending_extract` and the queue retries it. */
  | { kind: 'queued'; row: ReceiptRow; reason?: string; attempts?: CaptureAttemptTrace[] };

/**
 * Runs a captured photo through the pipeline. Never throws for transport
 * failures — those become `queued`, because the image is already saved and the
 * retry queue owns it from there.
 */
let dispatchInFlight: Promise<number> | null = null;
let imageBackupInFlight: Promise<number> | null = null;
let metricsFlushInFlight: Promise<number> | null = null;

export async function processCapture(
  photoUri: string,
  captureMode: CaptureMode = 'default',
  extractionMode: ExtractionMode = 'balanced',
  options?: {
    signal?: AbortSignal;
    defaultCurrency?: string;
    onDraft?: (draft: ReceiptFields, meta: { captureId: string; elapsedMs: number }) => void;
  },
): Promise<CaptureOutcome> {
  const signal = options?.signal;
  const captureStartedAt = Date.now();
  const metrics: CaptureMetricsPayload['metrics'] = {};
  let stepStartedAt = captureStartedAt;
  const markStep = (key: string) => {
    const now = Date.now();
    metrics[key] = now - stepStartedAt;
    stepStartedAt = now;
  };
  const logLatency = (step: string, extra?: Record<string, unknown>) => {
    if (!__DEV__) return;
    console.log('[capture:latency]', {
      step,
      elapsedMs: Date.now() - captureStartedAt,
      captureMode,
      extractionMode,
      ...extra,
    });
  };

  logLatency('start');
  // Deskew + crop to the document before compressing (iOS; null elsewhere or
  // when no page is found — then the original frame proceeds untouched). A
  // flattened page spends its pixels on print, not table.
  const corrected = await detectAndCorrect(photoUri);
  markStep('document_correction_ms');
  logLatency('document_correction_done', { corrected: Boolean(corrected) });
  if (__DEV__) {
    // The mock /extract gives the deskew no visible surface in the UI yet, so
    // this Metro line is the way to verify it fired on a real device.
    console.log(
      corrected
        ? `[document-scan] page found (confidence ${corrected.confidence.toFixed(2)}) → ${corrected.uri}`
        : '[document-scan] no page found — using original frame',
    );
  }
  const captureId = store.newCaptureId();
  const sourceImageUri = corrected?.uri ?? photoUri;
  let localOcrText: string | null = null;
  let rowImageUri = sourceImageUri;
  let backupSourceImageUri = sourceImageUri;

  if (extractionMode === 'balanced') {
    const ocrResizeStartedAt = Date.now();
    const ocrImage = await prepareForOcr(sourceImageUri);
    rowImageUri = ocrImage.uri;
    backupSourceImageUri = ocrImage.uri;
    metrics.ocr_image_resize_ms = Date.now() - ocrResizeStartedAt;
    metrics.ocr_input_width = ocrImage.width;
    metrics.ocr_input_height = ocrImage.height;
    metrics.ocr_timeout_ms = OCR_TIMEOUT_MS;
    logLatency('ocr_image_ready', {
      resized: ocrImage.resized,
      width: ocrImage.width,
      height: ocrImage.height,
    });
    const ocrStartedAt = Date.now();
    const ocr = await recognizeTextWithDeadline(ocrImage.uri, OCR_TIMEOUT_MS);
    localOcrText = ocr.text;
    metrics.local_ocr_ms = Date.now() - ocrStartedAt;
    metrics.local_ocr_timed_out = ocr.timedOut ? 1 : 0;
    logLatency('local_ocr_done', {
      hasText: Boolean(localOcrText),
      textLength: localOcrText?.length ?? 0,
      timedOut: ocr.timedOut,
    });
    const draft = localOcrText ? draftFromOcr(localOcrText, options?.defaultCurrency ?? 'USD') : null;
    if (draft) {
      logLatency('local_draft_ready', { captureId, merchant: draft.store });
      options?.onDraft?.(draft, { captureId, elapsedMs: Date.now() - captureStartedAt });
    }
    if (__DEV__) {
      console.log('[capture] local OCR completed', {
        captureId,
        hasText: Boolean(localOcrText),
        textLength: localOcrText?.length ?? 0,
        preview: localOcrText?.slice(0, 120),
      });
    }
  }

  // The row exists before the network is touched, so a crash/kill mid-request
  // still leaves the scan recoverable.
  const localRowStartedAt = Date.now();
  const row = await store.insertCaptured(rowImageUri, captureMode, extractionMode, captureId);
  metrics.local_row_ms = Date.now() - localRowStartedAt;
  logLatency('local_row_inserted', { captureId: row.id });

  if (extractionMode === 'balanced') {
    await store.setStatus(row.id, 'local_ocr_processing');
    await store.setLocalOcr(row.id, localOcrText, localOcrText ? 'local_ocr_done' : 'image_upload_pending');
  } else {
    await store.setStatus(row.id, 'image_upload_pending');
  }

  let extractStartedAt = 0;
  let durableImageUri = row.imageUri;
  let durableImagePromise: Promise<string> | null = null;
  try {
    await store.setStatus(row.id, 'llm_processing');
    logLatency('extract_request_start', { textOnly: Boolean(localOcrText) });
    extractStartedAt = Date.now();
    const ackPromise = extractClient.extract({
      captureId: row.id,
      imageUri: row.imageUri,
      mode: row.captureMode,
      extractionMode: localOcrText ? extractionMode : 'precise',
      defaultCurrency: options?.defaultCurrency,
      localOcrText,
      capturedAt: new Date(row.createdAt).toISOString(),
      signal,
    });
    const compressionStartedAt = Date.now();
    durableImagePromise = compressForUpload(backupSourceImageUri)
      .then(async (compressed) => {
        metrics.compression_ms = Date.now() - compressionStartedAt;
        logLatency('compression_done');
        const persistStartedAt = Date.now();
        const persisted = await persistCaptureFile(compressed, captureId);
        metrics.local_file_ms = Date.now() - persistStartedAt;
        durableImageUri = persisted;
        await store.setImageUri(row.id, persisted);
        logLatency('local_file_persisted', { captureId });
        return persisted;
      })
      .catch((error) => {
        if (__DEV__) console.warn('[capture] image file persistence queued', describeError(error));
        return row.imageUri;
    });
    const ack = await ackPromise;
    if (isVisibleDeadlineAck(ack)) {
      metrics.backend_extract_ms = Date.now() - extractStartedAt;
      metrics.total_to_response_ms = Date.now() - captureStartedAt;
      uploadCaptureMetrics({
        captureId: row.id,
        receiptId: row.receiptId,
        captureMode: row.captureMode,
        extractionMode: row.extractionMode,
        metrics: { ...metrics, total_to_ui_ms: metrics.total_to_response_ms },
        attempts: ack.attempts,
      });
      logLatency('extract_visible_deadline_queued', { captureId: row.id });
      await store.setStatus(row.id, 'llm_failed_retryable');
      await store.markRetry(row.id, 1, Date.now() + VISIBLE_DEADLINE_RETRY_DELAY_MS);
      void ack.deferred
        .then(async (lateAck) => {
          if (isVisibleDeadlineAck(lateAck) || isNotAReceipt(lateAck.response) || isDuplicateReceipt(lateAck.response)) return;
          const fields = toReceiptFields(lateAck.response);
          await store.markDispatched(row.id, lateAck.receiptId, fields);
          await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
          void durableImagePromise?.then(() => syncImageBackups());
          uploadCaptureMetrics({
            captureId: row.id,
            receiptId: lateAck.receiptId,
            captureMode: row.captureMode,
            extractionMode: row.extractionMode,
            metrics: { ...metrics, backend_extract_ms: Date.now() - extractStartedAt },
            attempts: lateAck.attempts,
          });
          if (__DEV__) console.log('[capture] visible-deadline request completed in background', { captureId: row.id });
        })
        .catch((error) => {
          if (__DEV__) console.warn('[capture] visible-deadline request stayed queued', describeError(error));
        });
      return { kind: 'queued', row, reason: undefined, attempts: ack.attempts };
    }
    if (isNotAReceipt(ack.response)) {
      // Not a receipt is a verdict, not a failure — don't leave it queued.
      await store.remove(row.id);
      await deleteLocalFile(durableImageUri);
      void durableImagePromise?.then(deleteLocalFile);
      return { kind: 'not_a_receipt', row };
    }
    if (isDuplicateReceipt(ack.response)) {
      await store.remove(row.id);
      await deleteLocalFile(durableImageUri);
      void durableImagePromise?.then(deleteLocalFile);
      return { kind: 'duplicate', row };
    }

    const fields = toReceiptFields(ack.response);
    metrics.backend_extract_ms = Date.now() - extractStartedAt;
    metrics.total_to_response_ms = Date.now() - captureStartedAt;
    logLatency('extract_response_received', { receiptId: ack.receiptId, merchant: fields.store, total: fields.total });
    await store.markDispatched(row.id, ack.receiptId, fields);
    if (extractionMode === 'balanced' && localOcrText) {
      await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
      logLatency('ui_ready_image_backup_queued', { receiptId: ack.receiptId });
      void durableImagePromise.then(async () => {
        void syncImageBackups();
      });
    } else {
      if (durableImagePromise) durableImageUri = await durableImagePromise;
      await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });
      await deleteLocalFile(durableImageUri);
      logLatency('image_backed_up_inline', { receiptId: ack.receiptId });
    }
    return {
      kind: 'extracted',
      row: {
        ...row,
        fields,
        receiptId: ack.receiptId,
        status: 'extracted',
        localOcrText,
        imageSyncStatus: extractionMode === 'balanced' && localOcrText ? 'pending_upload' : 'uploaded',
        imageUri: durableImageUri,
      },
      fields,
      metrics,
      attempts: ack.attempts,
      duplicateCandidate: ack.duplicateCandidate,
    };
  } catch (error) {
    const reason = describeError(error);
    const attempts = getCaptureAttempts(error);
    if (extractStartedAt > 0) metrics.backend_extract_ms = Date.now() - extractStartedAt;
    metrics.total_to_response_ms = Date.now() - captureStartedAt;
    uploadCaptureMetrics({
      captureId: row.id,
      receiptId: row.receiptId,
      captureMode: row.captureMode,
      extractionMode: row.extractionMode,
      metrics: { ...metrics, total_to_ui_ms: metrics.total_to_response_ms },
      attempts,
    });
    logLatency('extract_failed_queued', { reason });
    if (__DEV__) console.warn('[capture] extract queued', reason);
    await store.setStatus(row.id, 'llm_failed_retryable');
    await store.markRetry(row.id, 1, Date.now() + nextBackoffWithJitterMs(1));
    return { kind: 'queued', row, reason: __DEV__ ? reason : undefined, attempts };
  }
}

/** Swipe-up (or One-click's auto-confirm). Optimistic: local write, then sync. */
export async function confirm(id: string, fields: ReceiptFields): Promise<void> {
  await store.setSyncStatus(id, { resultSyncStatus: 'pending_sync' });
  await store.setFields(id, fields, 'confirmed_local');
  void syncConfirmed();
}

export async function syncConfirmed(): Promise<void> {
  const rows = await store.listUnsynced();

  for (const row of rows) {
    if (!row.receiptId || !row.fields) continue;
    try {
      await store.setSyncStatus(row.id, { resultSyncStatus: 'syncing' });
      await confirmReceiptClient.confirm({ receiptId: row.receiptId, fields: row.fields });
      await store.setSyncStatus(row.id, { resultSyncStatus: 'synced' });
      await store.setStatus(row.id, 'synced');
    } catch (error) {
      if (__DEV__) console.warn('[capture] confirm sync queued', describeError(error));
      const attempts = row.attempts + 1;
      if (attempts >= MAX_CONFIRM_SYNC_ATTEMPTS) {
        await store.setSyncStatus(row.id, { resultSyncStatus: 'sync_failed_final' });
      } else {
        await store.setSyncStatus(row.id, { resultSyncStatus: 'sync_failed' });
        await store.markRetry(row.id, attempts, Date.now() + nextBackoffWithJitterMs(attempts));
      }
      break;
    }
  }
}

export async function syncImageBackups(): Promise<number> {
  if (imageBackupInFlight) return imageBackupInFlight;
  imageBackupInFlight = dispatchImageBackups().finally(() => {
    imageBackupInFlight = null;
  });
  return imageBackupInFlight;
}

async function dispatchImageBackups(): Promise<number> {
  const rows = await store.listPendingImageBackups();
  let uploaded = 0;

  for (const row of rows) {
    try {
      if (!(await localFileExists(row.imageUri))) {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'missing_local_file' });
        if (__DEV__) {
          console.warn('[capture] image backup abandoned; local file missing', {
            captureId: row.id,
            imageUri: row.imageUri,
          });
        }
        continue;
      }
      await store.setSyncStatus(row.id, { imageSyncStatus: 'uploading' });
      await imageBackupClient.upload({
        captureId: row.id,
        imageUri: row.imageUri,
        mode: row.captureMode,
        extractionMode: row.extractionMode,
        capturedAt: new Date(row.createdAt).toISOString(),
      });
      await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });
      await deleteLocalFile(row.imageUri);
      const imageBackupMs = Date.now() - row.createdAt;
      void uploadCaptureMetrics({
        captureId: row.id,
        receiptId: null,
        captureMode: row.captureMode,
        extractionMode: row.extractionMode,
        metrics: { image_backup_ms: imageBackupMs },
      });
      if (__DEV__) {
        console.log('[capture:latency]', {
          step: 'background_image_backup_done',
          captureId: row.id,
          elapsedMs: imageBackupMs,
          extractionMode: row.extractionMode,
        });
      }
      uploaded += 1;
    } catch (error) {
      if (__DEV__) console.warn('[capture] image backup queued', describeError(error));
      const attempts = row.attempts + 1;
      if (attempts >= MAX_IMAGE_BACKUP_ATTEMPTS) {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'upload_failed_final' });
      } else {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'upload_failed' });
        await store.markRetry(row.id, attempts, Date.now() + nextBackoffWithJitterMs(attempts));
      }
      break;
    }
  }

  return uploaded;
}

export function uploadCaptureMetrics(input: CaptureMetricsPayload): void {
  void store.enqueueCaptureMetric(input)
    .then(() => flushCaptureMetrics())
    .catch((error) => {
      if (__DEV__) console.warn('[capture] metrics enqueue failed', describeError(error));
    });
}

export async function flushCaptureMetrics(): Promise<number> {
  if (metricsFlushInFlight) return metricsFlushInFlight;
  metricsFlushInFlight = dispatchCaptureMetrics().finally(() => {
    metricsFlushInFlight = null;
  });
  return metricsFlushInFlight;
}

async function dispatchCaptureMetrics(): Promise<number> {
  const queued = await store.listQueuedCaptureMetrics();
  let uploaded = 0;

  for (const item of queued) {
    try {
      await captureMetricsClient.upload(item.payload);
      await store.removeQueuedCaptureMetric(item.id);
      uploaded += 1;
    } catch (error) {
      if (__DEV__) console.warn('[capture] metrics upload queued', describeError(error));
      const attempts = item.attempts + 1;
      await store.markCaptureMetricRetry(item.id, attempts, Date.now() + nextBackoffWithJitterMs(attempts));
      break;
    }
  }

  return uploaded;
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
        extractionMode: row.localOcrText ? row.extractionMode : 'precise',
        localOcrText: row.localOcrText,
        capturedAt: new Date(row.createdAt).toISOString(),
      });
      if (isVisibleDeadlineAck(ack)) {
        await store.markRetry(row.id, row.attempts + 1, Date.now() + VISIBLE_DEADLINE_RETRY_DELAY_MS);
        continue;
      }
      if (isNotAReceipt(ack.response)) {
        await store.remove(row.id);
        await deleteLocalFile(row.imageUri);
        continue;
      }
      if (isDuplicateReceipt(ack.response)) {
        await store.remove(row.id);
        await deleteLocalFile(row.imageUri);
        continue;
      }
      await store.markDispatched(row.id, ack.receiptId, toReceiptFields(ack.response));
      if (row.extractionMode === 'balanced' && row.localOcrText) {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
        void syncImageBackups();
      } else {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });
        await deleteLocalFile(row.imageUri);
      }
      recovered += 1;
    } catch (error) {
      if (__DEV__) console.warn('[capture] retry queued', describeError(error));
      const attempts = row.attempts + 1;
      if (attempts >= MAX_EXTRACT_ATTEMPTS) {
        await store.markFinalFailure(row.id, 'llm_failed_final');
      } else {
        await store.setStatus(row.id, 'llm_failed_retryable');
        await store.markRetry(row.id, attempts, Date.now() + nextBackoffWithJitterMs(attempts));
      }
      // Still unreachable — leave it queued for the next reconnect.
      break;
    }
  }

  return recovered;
}
