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
  getExtractErrorCode,
  getExtractRetryAfterMs,
  imageBackupClient,
  toReceiptFields,
  type CaptureMetricsPayload,
  type CaptureAttemptTrace,
  type ExtractAck,
  type ExtractVisibleDeadlineAck,
} from '@/lib/receipts/client';
import { isTransientNetworkError } from '@/lib/network/retry';
import {
  scoreReceiptPreflight,
  type PreflightDecision,
  type PreflightWarning,
} from '@/lib/receipts/preflight';
import { applyServerQuota } from '@/lib/receipts/quota';
import * as store from '@/lib/receipts/store';
import {
  isDuplicateReceipt,
  isNotAReceipt,
  isCategory,
  type CaptureMode,
  type Category,
  type DuplicateCandidate,
  type ExtractionMode,
  type LocalDuplicateCandidate,
  type ReceiptFields,
  type ReceiptRow,
} from '@/lib/receipts/types';

/** B4 latency test: 640px long edge, lower JPEG quality. */
const TARGET_LONG_EDGE = 640;
const JPEG_QUALITY = 0.55;
const OCR_TARGET_LONG_EDGE = 1600;
const OCR_JPEG_QUALITY = 0.9;
const OCR_TIMEOUT_MS = 2500;
const PRECISE_PREFLIGHT_OCR_TIMEOUT_MS = 1200;
const CAPTURE_DIR = `${FileSystem.documentDirectory ?? ''}captures/`;
const MAX_BACKOFF_MS = 60_000;
const MAX_EXTRACT_ATTEMPTS = 5;
const MAX_IMAGE_BACKUP_ATTEMPTS = 5;
const VISIBLE_DEADLINE_RETRY_DELAY_MS = 15_000;
/**
 * How long a row may sit in an in-flight sync state before the queue assumes
 * the attempt died with the process and takes it back. Comfortably longer than
 * any request timeout, so a live request is never interrupted.
 */
const STALLED_SYNC_MS = 2 * 60_000;
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
/** If the server sent a 429 without a retry_after_s, assume its stated window. */
const RATE_LIMIT_FALLBACK_MS = 60_000;

/**
 * How long to wait when a capture was throttled rather than failed, or null if
 * this was not a throttle.
 *
 * A rate limit is "not now", not "not ever". It used to be indistinguishable
 * from a real failure: the client ignored retry_after_s, retried after a second,
 * and each refusal spent one of five attempts — so a capture could reach
 * llm_failed_final in under fifteen seconds over a limit that clears in sixty.
 * That is the opposite of why the server answers 429 rather than 402.
 */
function throttleRetryMs(error: unknown): number | null {
  if (getExtractErrorCode(error) !== 'RATE_LIMITED') return null;
  return getExtractRetryAfterMs(error) ?? RATE_LIMIT_FALLBACK_MS;
}

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

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const value = (error as { status?: unknown }).status;
  return typeof value === 'number' ? value : null;
}

function getProviderDelayReceiptId(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = (error as { receiptId?: unknown }).receiptId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Whether a failed confirm is worth trying again. The shared classifier only
 * counts 0 and 5xx as transient, so 408 and 429 would read as verdicts — and
 * treating a rate limit as a verdict here means losing the receipt. When the
 * stake is the user's only copy, ambiguity retries.
 */
function isRetryableConfirmError(error: unknown): boolean {
  if (isTransientNetworkError(error)) return true;
  const status = getErrorStatus(error);
  if (status === 408 || status === 429) return true;
  // A timed-out confirm aborts, and an abort is a stalled connection, not a
  // verdict. Without this the timeout added to bound that stall would itself
  // mark the receipt permanently failed.
  return /abort/i.test(describeError(error));
}

/**
 * Did this scan queue because the device could not reach the network, as
 * opposed to a slow or failing server? The UI says different things for the
 * two, and `reason` cannot answer it — that is stripped outside __DEV__, so a
 * release build has no other way to tell them apart.
 */
function isOfflineError(error: unknown): boolean {
  return /internet connection appears to be offline|network request failed|network connection was lost|fetch failed|unable to resolve host|could not connect to the server/i.test(
    describeError(error),
  );
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

function amountFromText(value: string): number | null {
  const normalized = value.replace(/,/g, '');
  const matches = [...normalized.matchAll(/(?:rs\.?|inr|₹|\$)?\s*(-?\d{1,7}(?:\.\d{1,2})?)/gi)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const amount = Number(matches[i][1]);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount * 100) / 100;
  }
  return null;
}

function parseDraftTotal(lines: string[]): number {
  const totalLine = /\b(grand\s*total|net\s*amount|amount\s*paid|balance\s*due|total)\b/i;
  const excluded = /\b(sub\s*total|subtotal|tax|gst|cgst|sgst|igst|change|round\s*off|saving|discount)\b/i;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!totalLine.test(line) || excluded.test(line)) continue;
    const amount = amountFromText(line);
    if (amount != null) return amount;
  }

  const amounts = lines
    .flatMap((line) => (excluded.test(line) ? [] : [amountFromText(line)]))
    .filter((amount): amount is number => amount != null && amount < 1_000_000);
  return amounts.length > 0 ? Math.max(...amounts) : 0;
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
    total: parseDraftTotal(lines),
    category: isCategory(DRAFT_CATEGORY) ? DRAFT_CATEGORY : 'Miscellaneous',
    handwritten_notes: '',
  };
}

export type LocalDuplicateDecision = 'view_existing' | 'save_anyway';

// Re-exported so camera.tsx and anything else already importing these from the
// capture pipeline keeps working; the rule itself lives in a dependency-free
// module so it can be tested without a device.
export type { PreflightDecision, PreflightWarning };

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
  /** Same device already has a likely matching receipt and the user chose it. */
  | { kind: 'local_duplicate'; candidate: LocalDuplicateCandidate }
  /** Precise preflight was rejected by the user before backend/model work. */
  | { kind: 'preflight_rejected' }
  /** No free scans left. Retrying can't fix this, so it's terminal, not queued. */
  | { kind: 'quota_exhausted'; row: ReceiptRow }
  /**
   * Anything else. The row is marked `llm_failed_retryable` and the queue
   * re-drives it on reconnect. `offline` is true when the device could not
   * reach the network at all, which is the only case the UI can honestly
   * blame on connectivity.
   */
  | {
      kind: 'queued';
      row: ReceiptRow;
      reason?: string;
      offline?: boolean;
      attempts?: CaptureAttemptTrace[];
      deferred?: Promise<CaptureOutcome>;
    };

/**
 * Runs a captured photo through the pipeline. Never throws for transport
 * failures — those become `queued`, because the image is already saved and the
 * retry queue owns it from there.
 */
let dispatchInFlight: Promise<number> | null = null;
let imageBackupInFlight: Promise<number> | null = null;
let imageBackupRetryTimer: ReturnType<typeof setTimeout> | null = null;
let metricsFlushInFlight: Promise<number> | null = null;

export async function processCapture(
  photoUri: string,
  captureMode: CaptureMode = 'default',
  extractionMode: ExtractionMode = 'balanced',
  options?: {
    signal?: AbortSignal;
    defaultCurrency?: string;
    userId?: string | null;
    onDraft?: (draft: ReceiptFields, meta: { captureId: string; elapsedMs: number }) => void;
    onLocalDuplicateCandidate?: (
      candidate: LocalDuplicateCandidate,
      draft: ReceiptFields,
    ) => Promise<LocalDuplicateDecision>;
    onPreflightWarning?: (warning: PreflightWarning) => Promise<PreflightDecision>;
    onPrecisePreflightAccepted?: () => void;
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
  let duplicateOverride = false;
  let duplicateOfLocalRowId: string | null = null;
  let duplicateOfReceiptId: string | null = null;
  let duplicateMatchStrength: 'weak' | 'strong' | null = null;

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

    // The same check Precise runs, on text this mode already read. Catching an
    // obvious non-receipt here costs nothing and skips the model call outright,
    // rather than paying for one and refunding it afterwards. It runs before
    // the draft card so a non-receipt never renders as a receipt.
    const balancedWarning = scoreReceiptPreflight(localOcrText, Boolean(corrected), ocr.timedOut);
    logLatency('preflight_done', {
      mode: 'balanced',
      warning: balancedWarning?.confidence ?? null,
      amountCount: balancedWarning?.amountCount ?? null,
      keywordCount: balancedWarning?.keywordCount ?? null,
    });
    if (balancedWarning) {
      const decision = await options?.onPreflightWarning?.(balancedWarning);
      if (decision !== 'continue') return { kind: 'preflight_rejected' };
    }
    const draft = localOcrText ? draftFromOcr(localOcrText, options?.defaultCurrency ?? 'USD') : null;
    if (draft) {
      logLatency('local_draft_ready', { captureId, merchant: draft.store, total: draft.total });
      options?.onDraft?.(draft, { captureId, elapsedMs: Date.now() - captureStartedAt });
      const localDuplicate = await store.findLocalDuplicateCandidate(draft, {
        userId: options?.userId,
        ocrText: localOcrText,
      });
      if (localDuplicate) {
        logLatency('local_duplicate_candidate', {
          captureId,
          matchedReceiptId: localDuplicate.matchedReceiptId,
          matchedLocalRowId: localDuplicate.matchedLocalRowId,
        });
        const decision = await options?.onLocalDuplicateCandidate?.(localDuplicate, draft);
        if (decision === 'view_existing') return { kind: 'local_duplicate', candidate: localDuplicate };
        if (decision === 'save_anyway') {
          duplicateOverride = true;
          duplicateOfLocalRowId = localDuplicate.matchedLocalRowId;
          duplicateOfReceiptId =
            localDuplicate.matchedReceiptId !== localDuplicate.matchedLocalRowId ? localDuplicate.matchedReceiptId : null;
          duplicateMatchStrength = localDuplicate.matchStrength;
        }
      }
    }
    if (__DEV__) {
      console.log('[capture] local OCR completed', {
        captureId,
        hasText: Boolean(localOcrText),
        textLength: localOcrText?.length ?? 0,
        preview: localOcrText?.slice(0, 120),
      });
    }
  } else {
    const ocrResizeStartedAt = Date.now();
    const ocrImage = await prepareForOcr(sourceImageUri);
    metrics.ocr_image_resize_ms = Date.now() - ocrResizeStartedAt;
    metrics.ocr_input_width = ocrImage.width;
    metrics.ocr_input_height = ocrImage.height;
    metrics.ocr_timeout_ms = PRECISE_PREFLIGHT_OCR_TIMEOUT_MS;
    logLatency('precise_preflight_ocr_image_ready', {
      resized: ocrImage.resized,
      width: ocrImage.width,
      height: ocrImage.height,
    });
    const preflightStartedAt = Date.now();
    const preflightOcr = await recognizeTextWithDeadline(ocrImage.uri, PRECISE_PREFLIGHT_OCR_TIMEOUT_MS);
    metrics.local_ocr_ms = Date.now() - preflightStartedAt;
    metrics.local_ocr_timed_out = preflightOcr.timedOut ? 1 : 0;
    const warning = scoreReceiptPreflight(preflightOcr.text, Boolean(corrected), preflightOcr.timedOut);
    logLatency('precise_preflight_done', {
      textLength: preflightOcr.text?.length ?? 0,
      timedOut: preflightOcr.timedOut,
      warning: warning?.confidence ?? null,
      amountCount: warning?.amountCount ?? null,
      keywordCount: warning?.keywordCount ?? null,
    });
    if (warning) {
      const decision = await options?.onPreflightWarning?.(warning);
      if (decision !== 'continue') return { kind: 'preflight_rejected' };
    }
    options?.onPrecisePreflightAccepted?.();
  }

  // The row exists before the network is touched, so a crash/kill mid-request
  // still leaves the scan recoverable.
  const localRowStartedAt = Date.now();
  const row = await store.insertCaptured(rowImageUri, captureMode, extractionMode, captureId);
  if (duplicateOfLocalRowId) {
    await store.setDuplicateRelation(row.id, duplicateOfLocalRowId, duplicateMatchStrength);
  }
  metrics.local_row_ms = Date.now() - localRowStartedAt;
  logLatency('local_row_inserted', { captureId: row.id });

  if (extractionMode === 'balanced') {
    await store.setStatus(row.id, 'local_ocr_processing');
    await store.setLocalOcr(row.id, localOcrText, localOcrText ? 'local_ocr_done' : 'image_upload_pending');
    const draft = localOcrText ? draftFromOcr(localOcrText, options?.defaultCurrency ?? 'USD') : null;
    if (draft) {
      await store.setDedupeSignals(
        row.id,
        store.buildDedupeKey(draft, options?.userId),
        store.buildOcrFingerprint(localOcrText),
      );
    }
  } else {
    await store.setStatus(row.id, 'image_upload_pending');
  }

  let extractStartedAt = 0;
  let durableImageUri = row.imageUri;
  let durableImagePromise: Promise<string> | null = null;
  try {
    await store.setStatus(row.id, 'llm_processing');
    let requestImageUri = row.imageUri;
    if (!localOcrText) {
      const compressionStartedAt = Date.now();
      const compressed = await compressForUpload(backupSourceImageUri);
      metrics.compression_ms = Date.now() - compressionStartedAt;
      logLatency('compression_done');
      const persistStartedAt = Date.now();
      durableImageUri = await persistCaptureFile(compressed, captureId);
      metrics.local_file_ms = Date.now() - persistStartedAt;
      await store.setImageUri(row.id, durableImageUri);
      requestImageUri = durableImageUri;
      durableImagePromise = Promise.resolve(durableImageUri);
      logLatency('local_file_persisted', { captureId });
    }
    logLatency('extract_request_start', { textOnly: Boolean(localOcrText) });
    extractStartedAt = Date.now();
    const ackPromise = extractClient.extract({
      captureId: row.id,
      imageUri: requestImageUri,
      mode: row.captureMode,
      extractionMode: localOcrText ? extractionMode : 'precise',
      defaultCurrency: options?.defaultCurrency,
      localOcrText,
      duplicateOverride,
      duplicateOfReceiptId,
      duplicateMatchStrength,
      capturedAt: new Date(row.createdAt).toISOString(),
      signal,
    });
    if (localOcrText) {
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
    }
    const ack = await ackPromise;
    // Every completed call carries the server's own balance — cheaper and more
    // accurate than a separate refresh.
    if (!isVisibleDeadlineAck(ack)) void applyServerQuota(options?.userId, ack.scansRemaining);
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
      const deferred = ack.deferred
        .then(async (lateAck): Promise<CaptureOutcome> => {
          if (isVisibleDeadlineAck(lateAck)) return { kind: 'queued', row, attempts: lateAck.attempts };
          void applyServerQuota(options?.userId, lateAck.scansRemaining);
          if (isNotAReceipt(lateAck.response)) {
            await store.remove(row.id);
            await deleteLocalFile(durableImageUri);
            void durableImagePromise?.then(deleteLocalFile);
            return { kind: 'not_a_receipt', row };
          }
          if (isDuplicateReceipt(lateAck.response)) {
            await store.remove(row.id);
            await deleteLocalFile(durableImageUri);
            void durableImagePromise?.then(deleteLocalFile);
            return { kind: 'duplicate', row };
          }
          const fields = toReceiptFields(lateAck.response);
          const receiptId = lateAck.receiptId;
          const lateMetrics = { ...metrics, backend_extract_ms: Date.now() - extractStartedAt };
          await store.markDispatched(row.id, lateAck.receiptId, fields);
          await store.setDedupeSignals(
            row.id,
            store.buildDedupeKey(fields, options?.userId),
            store.buildOcrFingerprint(localOcrText),
          );
          const imageSyncStatus = row.extractionMode === 'balanced' && localOcrText ? 'pending_upload' : 'uploaded';
          await store.setSyncStatus(row.id, { imageSyncStatus });
          if (imageSyncStatus === 'pending_upload') void durableImagePromise?.then(() => syncImageBackups());
          else void durableImagePromise?.then(deleteLocalFile);
          uploadCaptureMetrics({
            captureId: row.id,
            receiptId,
            captureMode: row.captureMode,
            extractionMode: row.extractionMode,
            metrics: lateMetrics,
            attempts: lateAck.attempts,
          });
          if (__DEV__) console.log('[capture] visible-deadline request completed in background', { captureId: row.id });
          return {
            kind: 'extracted',
            row: {
              ...row,
              fields,
              receiptId,
              status: 'extracted',
              localOcrText: null,
              dedupeKey: store.buildDedupeKey(fields, options?.userId),
              ocrFingerprint: store.buildOcrFingerprint(localOcrText),
              imageSyncStatus,
              imageUri: durableImageUri,
            },
            fields,
            metrics: lateMetrics,
            attempts: lateAck.attempts,
            duplicateCandidate: lateAck.duplicateCandidate,
          };
        })
        .catch(async (error): Promise<CaptureOutcome> => {
          if (getExtractErrorCode(error) === 'QUOTA_EXHAUSTED') {
            await store.markFinalFailure(row.id, 'blocked_quota');
            return { kind: 'quota_exhausted', row };
          }
          if (__DEV__) console.warn('[capture] visible-deadline request stayed queued', describeError(error));
          return {
            kind: 'queued' as const,
            row,
            reason: __DEV__ ? describeError(error) : undefined,
            offline: isOfflineError(error),
            attempts: ack.attempts,
          };
        });
      return { kind: 'queued', row, reason: undefined, attempts: ack.attempts, deferred };
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
    await store.setDedupeSignals(
      row.id,
      store.buildDedupeKey(fields, options?.userId),
      store.buildOcrFingerprint(localOcrText),
    );
    if (extractionMode === 'balanced' && localOcrText) {
      await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
      logLatency('ui_ready_image_backup_queued', { receiptId: ack.receiptId });
      void durableImagePromise?.then(async () => {
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
        localOcrText: null,
        dedupeKey: store.buildDedupeKey(fields, options?.userId),
        ocrFingerprint: store.buildOcrFingerprint(localOcrText),
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
    if (getExtractErrorCode(error) === 'PROVIDER_DELAY') {
      const receiptId = getProviderDelayReceiptId(error);
      await store.markProviderDelayed(row.id, row.attempts);
      if (receiptId) {
        await store.setServerReceipt(row.id, receiptId);
      }
      if (durableImagePromise) durableImageUri = await durableImagePromise;
      if (row.extractionMode === 'balanced' && localOcrText) {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
        void syncImageBackups();
      } else {
        await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });
        await deleteLocalFile(durableImageUri);
      }
      return { kind: 'queued', row, reason: 'PROVIDER_DELAY', offline: false, attempts };
    }
    if (getExtractErrorCode(error) === 'QUOTA_EXHAUSTED') {
      // Retrying can't fix "out of scans" — treat it as a verdict, not a transient
      // failure, so it never enters the backoff/retry queue. But it is the user's
      // photo: it is kept, and listed as blocked, so upgrading makes it scannable
      // rather than making them take it again. Deleting it here was defensible
      // only while it could not happen without the user watching.
      logLatency('extract_quota_exhausted', {});
      await store.markFinalFailure(row.id, 'blocked_quota');
      return { kind: 'quota_exhausted', row };
    }
    logLatency('extract_failed_queued', { reason });
    if (__DEV__) console.warn('[capture] extract queued', reason);
    await store.setStatus(row.id, 'llm_failed_retryable');
    // A throttle leaves the attempt count alone: it did not fail, it was not
    // served, and spending the budget on it is what killed these captures.
    const throttleMs = throttleRetryMs(error);
    await store.markRetry(
      row.id,
      throttleMs == null ? 1 : row.attempts,
      Date.now() + (throttleMs ?? nextBackoffWithJitterMs(1)),
    );
    return { kind: 'queued', row, reason: __DEV__ ? reason : undefined, offline: isOfflineError(error), attempts };
  }
}

/** Swipe-up (or One-click's auto-confirm). Optimistic: local write, then sync. */
export async function confirm(id: string, fields: ReceiptFields, userId?: string | null): Promise<void> {
  const row = await store.getById(id);
  await store.setSyncStatus(id, { resultSyncStatus: 'pending_sync' });
  await store.setFields(id, fields, 'confirmed_local');
  await store.setDedupeSignals(id, store.buildDedupeKey(fields, userId), row?.ocrFingerprint ?? null);
  void syncConfirmed();
}

/**
 * Wipe the local receipt store because a different account has signed in.
 *
 * Local rows carry no user id, so without this the incoming user would see the
 * previous one's receipts — and, since the restore only runs against an empty
 * database, would never get their own. Deliberately not called on sign-out: a
 * user signing back into their own account would lose any capture that had not
 * yet reached the server.
 */
export async function clearLocalReceiptsForAccountSwitch(): Promise<void> {
  const uris = await store.listAllImageUris();
  await Promise.all(uris.map((uri) => deleteLocalFile(uri).catch(() => {})));
  await store.clearReceiptData();
  if (__DEV__) console.warn(`[capture] cleared ${uris.length} local receipt image(s) for account switch`);
}

/**
 * Remove a receipt the server says is gone, taking its image with it. Used
 * when a pull brings back a tombstone — a retention purge, or a deletion made
 * anywhere other than this device.
 */
export async function deleteLocalReceipt(captureId: string): Promise<void> {
  const row = await store.getById(captureId);
  if (!row) return;
  if (row.imageUri) await deleteLocalFile(row.imageUri).catch(() => {});
  await store.remove(captureId);
}

export async function syncConfirmed(): Promise<void> {
  const reclaimed = await store.reclaimStalledSyncs(STALLED_SYNC_MS);
  if (reclaimed > 0 && __DEV__) console.warn(`[capture] reclaimed ${reclaimed} stalled sync row(s)`);

  const rows = await store.listUnsynced();

  for (const row of rows) {
    // A confirmed receipt with nothing to address it to. Skipping silently is
    // how a row can sit "saved" on the device forever while the server never
    // hears about it — say so, at least, rather than dropping it wordlessly.
    if (!row.receiptId || !row.fields) {
      if (__DEV__) {
        console.warn('[capture] confirm sync skipped — nothing to send', {
          id: row.id,
          hasReceiptId: Boolean(row.receiptId),
          hasFields: Boolean(row.fields),
          status: row.status,
          resultSyncStatus: row.resultSyncStatus,
        });
      }
      continue;
    }
    try {
      await store.setSyncStatus(row.id, { resultSyncStatus: 'syncing' });
      await confirmReceiptClient.confirm({ receiptId: row.receiptId, fields: row.fields });
      await store.setSyncStatus(row.id, { resultSyncStatus: 'synced' });
      await store.setStatus(row.id, 'synced');
    } catch (error) {
      if (__DEV__) console.warn('[capture] confirm sync queued', describeError(error));

      // A verdict the server will repeat forever — a malformed payload, or a
      // receipt row that no longer exists. Retrying cannot change the answer,
      // so this one stops here rather than blocking the rest of the queue.
      if (!isRetryableConfirmError(error)) {
        await store.setSyncStatus(row.id, { resultSyncStatus: 'sync_failed_final' });
        continue;
      }

      // Transport or server trouble. This must never become terminal: until
      // the server has the receipt it exists on this device alone, so giving
      // up is data loss — and the old five-attempt cap did exactly that, then
      // left the row in a state nothing ever retried. Backoff is capped, so
      // retrying indefinitely stays cheap.
      const attempts = row.attempts + 1;
      await store.setSyncStatus(row.id, { resultSyncStatus: 'sync_failed' });
      await store.markRetry(row.id, attempts, Date.now() + nextBackoffWithJitterMs(attempts));
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

/** Keep a reachable app draining image backups without waiting for a network event. */
function scheduleImageBackupRetry(nextRetryAt: number): void {
  if (imageBackupRetryTimer) clearTimeout(imageBackupRetryTimer);
  imageBackupRetryTimer = setTimeout(() => {
    imageBackupRetryTimer = null;
    void syncImageBackups();
  }, Math.max(0, nextRetryAt - Date.now()));
}

async function dispatchImageBackups(): Promise<number> {
  await store.reclaimStalledSyncs(STALLED_SYNC_MS);
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
        const nextRetryAt = Date.now() + nextBackoffWithJitterMs(attempts);
        await store.markRetry(row.id, attempts, nextRetryAt);
        scheduleImageBackupRetry(nextRetryAt);
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
/**
 * How long a blocked or failed capture is kept before its photo is discarded.
 *
 * Long enough that upgrading a week later still recovers the receipt, short
 * enough that an account which never comes back does not keep every rejected
 * photo forever.
 */
export const ABANDONED_CAPTURE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Hand a blocked or permanently failed capture back to the queue.
 *
 * The photo was kept for exactly this. Used by the Retry action in Search —
 * after an upgrade for a blocked_quota row, or on demand for one that failed.
 */
export async function retryBlockedCapture(id: string): Promise<void> {
  const row = await store.getById(id);
  if (!row) return;
  if (!(await localFileExists(row.imageUri))) {
    // The photo is what makes a retry possible; without it there is nothing to
    // send, and leaving the row listed as retryable would promise otherwise.
    await store.markFinalFailure(id, 'llm_failed_final');
    return;
  }
  await store.requeueForExtract(id);
  void retryPending();
}

/**
 * Hand a permanently failed image upload back to the backup queue.
 *
 * Distinct from retryBlockedCapture: that one re-runs *extraction*, which for
 * these rows already succeeded — the receipt and its fields are fine, it is only
 * the photo that never reached Storage. Requeueing for extract would spend a
 * scan re-reading a receipt the user already has.
 *
 * Under DL-002 the device holds the only copy of that photo until the upload
 * confirms, which is why this exists at all: five failed attempts used to leave
 * the row in a state nothing read and nothing retried.
 */
export async function retryFailedImageUpload(id: string): Promise<void> {
  const row = await store.getById(id);
  if (!row) return;
  if (!(await localFileExists(row.imageUri))) {
    // Nothing left to upload. Say so rather than queueing work that will fail
    // on its first attempt and land the row straight back here.
    await store.setSyncStatus(id, { imageSyncStatus: 'missing_local_file' });
    return;
  }
  await store.requeueImageBackup(id);
  void syncImageBackups();
}

/**
 * Discard captures the user could have acted on and didn't. Keeping a blocked
 * capture's photo is what makes it recoverable; this is the other half of that
 * bargain, and without it the capture directory only ever grows.
 */
export async function purgeAbandonedCaptures(ttlMs = ABANDONED_CAPTURE_TTL_MS): Promise<number> {
  const rows = await store.listAbandoned(ttlMs);
  for (const row of rows) {
    await deleteLocalFile(row.imageUri);
    await store.remove(row.id);
  }
  if (__DEV__ && rows.length > 0) console.log('[capture] purged abandoned captures', { count: rows.length });
  return rows.length;
}

export async function retryPending(): Promise<number> {
  if (dispatchInFlight) return dispatchInFlight;
  dispatchInFlight = dispatchPending().finally(() => {
    dispatchInFlight = null;
  });
  return dispatchInFlight;
}

/**
 * Applies a queued row's result when it lands after the visible deadline. Same
 * terminal outcomes as the inline path — the only difference is that no screen
 * is watching, so there is nothing to tell the user.
 */
async function applyDeferredDispatch(row: ReceiptRow, deferred: Promise<ExtractAck>): Promise<void> {
  try {
    const ack = await deferred;
    if (isVisibleDeadlineAck(ack)) return;
    void applyServerQuota(null, ack.scansRemaining);
    if (isNotAReceipt(ack.response) || isDuplicateReceipt(ack.response)) {
      await store.remove(row.id);
      await deleteLocalFile(row.imageUri);
      return;
    }
    await store.markDispatched(row.id, ack.receiptId, toReceiptFields(ack.response));
    if (row.extractionMode === 'balanced' && row.localOcrText) {
      await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
      void syncImageBackups();
    } else {
      await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });
      await deleteLocalFile(row.imageUri);
    }
  } catch (error) {
    if (getExtractErrorCode(error) === 'QUOTA_EXHAUSTED') {
      await store.markFinalFailure(row.id, 'blocked_quota');
      return;
    }
    // Anything else stays queued; the row is already scheduled for another try.
    if (__DEV__) console.warn('[capture] deferred retry stayed queued', describeError(error));
  }
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
        // The request is still running. Dropping it here is how a row gets
        // stranded as "Processing receipt" while the server has actually
        // finished — or has rejected it outright.
        void applyDeferredDispatch(row, ack.deferred);
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
      if (getExtractErrorCode(error) === 'PROVIDER_DELAY') {
        const receiptId = getProviderDelayReceiptId(error);
        await store.markProviderDelayed(row.id, row.attempts);
        if (receiptId) await store.setServerReceipt(row.id, receiptId);
        if (row.extractionMode === 'balanced' && row.localOcrText) {
          await store.setSyncStatus(row.id, { imageSyncStatus: 'pending_upload' });
          void syncImageBackups();
        } else {
          await store.setSyncStatus(row.id, { imageSyncStatus: 'uploaded' });
          await deleteLocalFile(row.imageUri);
        }
        continue;
      }
      if (getExtractErrorCode(error) === 'QUOTA_EXHAUSTED') {
        // Nobody is watching this one: it is the reconnect drain. Which is
        // exactly why it must not delete anything — a receipt photographed
        // offline used to be destroyed here, silently and permanently, the
        // moment connectivity returned on an exhausted account. It is left
        // listed as blocked instead, with its photo, and never retried.
        await store.markFinalFailure(row.id, 'blocked_quota');
        continue;
      }
      if (__DEV__) console.warn('[capture] retry queued', describeError(error));
      // Throttled, not failed. Wait exactly as long as the server asked, and
      // never let it reach a terminal state — the window always clears, so a
      // capture that is merely too early must not become "could not be
      // processed".
      const throttleMs = throttleRetryMs(error);
      if (throttleMs != null) {
        await store.setStatus(row.id, 'llm_failed_retryable');
        await store.markRetry(row.id, row.attempts, Date.now() + throttleMs);
        break;
      }
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
