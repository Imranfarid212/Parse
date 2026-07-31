/**
 * Local receipt store (expo-sqlite). Every photo becomes a row the instant it
 * is taken, so a scan can never be lost between the shutter and the server —
 * and we can always answer "which ones haven't come back yet".
 *
 * Status flow (see types.ts):
 *   pending_extract → extracted → confirmed_local → synced
 * A row that never got past pending_extract is what the retry queue re-drives
 * on reconnect; that queue is what makes "Your receipt is being processed"
 * an honest message rather than a green check over a dropped receipt.
 */
import * as SQLite from 'expo-sqlite';

import type {
  CaptureMode,
  ExtractionMode,
  LocalDuplicateCandidate,
  ReceiptFields,
  ReceiptRow,
  ReceiptStatus,
} from '@/lib/receipts/types';
import type { CaptureMetricsPayload } from '@/lib/receipts/client';

const DB_NAME = 'parse.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS receipts (
      id         TEXT PRIMARY KEY NOT NULL,
      image_uri  TEXT NOT NULL,
      capture_mode TEXT NOT NULL DEFAULT 'default',
      extraction_mode TEXT NOT NULL DEFAULT 'balanced',
      status     TEXT NOT NULL,
      fields     TEXT,
      local_ocr_text TEXT,
      dedupe_key TEXT,
      ocr_fingerprint TEXT,
      duplicate_of TEXT,
      duplicate_match_strength TEXT,
      image_sync_status TEXT NOT NULL DEFAULT 'local_only',
      result_sync_status TEXT NOT NULL DEFAULT 'local_only',
      attempts   INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL DEFAULT 0,
      receipt_id TEXT,
      acked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_status  ON receipts (status);
    CREATE INDEX IF NOT EXISTS idx_receipts_retry   ON receipts (status, next_retry_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts (created_at DESC);
    CREATE TABLE IF NOT EXISTS receipt_metric_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_metric_queue_retry ON receipt_metric_queue (next_retry_at, created_at);
    CREATE TABLE IF NOT EXISTS quota_cache (
      user_id    TEXT PRIMARY KEY NOT NULL,
      remaining  INTEGER,
      paywall    TEXT NOT NULL DEFAULT 'plus',
      fetched_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_cache (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      user_id       TEXT NOT NULL,
      user_json     TEXT,
      profile_json  TEXT,
      categories_json TEXT NOT NULL DEFAULT '[]',
      selected_category_ids_json TEXT NOT NULL DEFAULT '[]',
      fetched_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
  await ensureColumn(db, 'capture_mode', "ALTER TABLE receipts ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'default'");
  await ensureColumn(db, 'extraction_mode', "ALTER TABLE receipts ADD COLUMN extraction_mode TEXT NOT NULL DEFAULT 'balanced'");
  await ensureColumn(db, 'local_ocr_text', 'ALTER TABLE receipts ADD COLUMN local_ocr_text TEXT');
  await ensureColumn(db, 'dedupe_key', 'ALTER TABLE receipts ADD COLUMN dedupe_key TEXT');
  await ensureColumn(db, 'ocr_fingerprint', 'ALTER TABLE receipts ADD COLUMN ocr_fingerprint TEXT');
  await ensureColumn(db, 'duplicate_of', 'ALTER TABLE receipts ADD COLUMN duplicate_of TEXT');
  await ensureColumn(db, 'duplicate_match_strength', 'ALTER TABLE receipts ADD COLUMN duplicate_match_strength TEXT');
  await ensureColumn(
    db,
    'image_sync_status',
    "ALTER TABLE receipts ADD COLUMN image_sync_status TEXT NOT NULL DEFAULT 'local_only'",
  );
  await ensureColumn(
    db,
    'result_sync_status',
    "ALTER TABLE receipts ADD COLUMN result_sync_status TEXT NOT NULL DEFAULT 'local_only'",
  );
  await ensureColumn(db, 'attempts', 'ALTER TABLE receipts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'next_retry_at', 'ALTER TABLE receipts ADD COLUMN next_retry_at INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'receipt_id', 'ALTER TABLE receipts ADD COLUMN receipt_id TEXT');
  await ensureColumn(db, 'acked_at', 'ALTER TABLE receipts ADD COLUMN acked_at INTEGER');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_receipts_dedupe ON receipts (dedupe_key, created_at DESC)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_receipts_duplicate_of ON receipts (duplicate_of, created_at DESC)');
  return db;
}

async function ensureColumn(db: SQLite.SQLiteDatabase, name: string, sql: string): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(receipts)');
  if (!columns.some((column) => column.name === name)) await db.execAsync(sql);
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

type Persisted = {
  id: string;
  image_uri: string;
  capture_mode: CaptureMode;
  extraction_mode: ExtractionMode;
  status: ReceiptStatus;
  fields: string | null;
  local_ocr_text: string | null;
  dedupe_key: string | null;
  ocr_fingerprint: string | null;
  duplicate_of: string | null;
  duplicate_match_strength: 'weak' | 'strong' | null;
  image_sync_status: ReceiptRow['imageSyncStatus'];
  result_sync_status: ReceiptRow['resultSyncStatus'];
  attempts: number;
  next_retry_at: number;
  receipt_id: string | null;
  acked_at: number | null;
  created_at: number;
  updated_at: number;
};

type MetricQueuePersisted = {
  id: number;
  payload: string;
  attempts: number;
  next_retry_at: number;
};

export type QueuedCaptureMetric = {
  id: number;
  payload: CaptureMetricsPayload;
  attempts: number;
  nextRetryAt: number;
};

const hydrate = (r: Persisted): ReceiptRow => ({
  id: r.id,
  imageUri: r.image_uri,
  captureMode: r.capture_mode,
  extractionMode: r.extraction_mode,
  status: r.status,
  fields: r.fields ? (JSON.parse(r.fields) as ReceiptFields) : null,
  localOcrText: r.local_ocr_text,
  dedupeKey: r.dedupe_key,
  ocrFingerprint: r.ocr_fingerprint,
  duplicateOf: r.duplicate_of,
  duplicateMatchStrength: r.duplicate_match_strength,
  imageSyncStatus: r.image_sync_status,
  resultSyncStatus: r.result_sync_status,
  attempts: r.attempts,
  nextRetryAt: r.next_retry_at,
  receiptId: r.receipt_id,
  ackedAt: r.acked_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const normalizeMerchantKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|inc|llc|store|market)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const merchantsMatch = (a: string, b: string) => {
  const left = normalizeMerchantKey(a);
  const right = normalizeMerchantKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left));
};

const DEDUPE_STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'bill',
  'invoice',
  'receipt',
  'total',
  'amount',
  'cash',
  'card',
  'gst',
  'cgst',
  'sgst',
  'igst',
  'tax',
  'qty',
  'rate',
  'item',
  'name',
  'phone',
]);

function hashToken(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function buildDedupeKey(fields: ReceiptFields, userId?: string | null): string | null {
  if (!userId || !fields.date || !fields.currency || fields.total <= 0) return null;
  const totalMinor = Math.round(fields.total * 100);
  if (!Number.isFinite(totalMinor) || totalMinor <= 0) return null;
  return ['v1', userId, fields.date, fields.currency.toUpperCase(), String(totalMinor)].join('|');
}

export function buildOcrFingerprint(text: string | null | undefined): string | null {
  if (!text) return null;
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && token.length <= 32 && !DEDUPE_STOP_WORDS.has(token));
  const uniqueHashes = [...new Set(tokens.map(hashToken))].sort().slice(0, 160);
  return uniqueHashes.length > 0 ? JSON.stringify(uniqueHashes) : null;
}

function parseFingerprint(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((token): token is string => typeof token === 'string') : [];
  } catch {
    return [];
  }
}

function fingerprintSimilarity(leftValue: string | null | undefined, rightValue: string | null | undefined): number {
  const left = parseFingerprint(leftValue);
  const right = parseFingerprint(rightValue);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of left) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 ? intersection / union : 0;
}

export const newCaptureId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

/** Called the moment the shutter fires — before /extract is even attempted. */
export async function insertCaptured(
  imageUri: string,
  captureMode: CaptureMode,
  extractionMode: ExtractionMode,
  captureId = newCaptureId(),
): Promise<ReceiptRow> {
  const db = await getDb();
  const now = Date.now();
  const row: ReceiptRow = {
    id: captureId,
    imageUri,
    captureMode,
    extractionMode,
    status: 'local_captured',
    fields: null,
    localOcrText: null,
    dedupeKey: null,
    ocrFingerprint: null,
    duplicateOf: null,
    duplicateMatchStrength: null,
    imageSyncStatus: 'local_only',
    resultSyncStatus: 'local_only',
    attempts: 0,
    nextRetryAt: now,
    receiptId: null,
    ackedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.runAsync(
    'INSERT INTO receipts (id, image_uri, capture_mode, extraction_mode, status, fields, local_ocr_text, dedupe_key, ocr_fingerprint, duplicate_of, duplicate_match_strength, image_sync_status, result_sync_status, attempts, next_retry_at, receipt_id, acked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      row.id,
      row.imageUri,
      row.captureMode,
      row.extractionMode,
      row.status,
      null,
      null,
      null,
      null,
      null,
      null,
      row.imageSyncStatus,
      row.resultSyncStatus,
      row.attempts,
      row.nextRetryAt,
      null,
      null,
      now,
      now,
    ],
  );
  return row;
}

export async function setDuplicateRelation(
  id: string,
  duplicateOf: string | null,
  matchStrength: 'weak' | 'strong' | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET duplicate_of = ?, duplicate_match_strength = ?, updated_at = ? WHERE id = ?', [
    duplicateOf,
    matchStrength,
    Date.now(),
    id,
  ]);
}

export async function setLocalOcr(id: string, text: string | null, status: ReceiptStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET local_ocr_text = ?, status = ?, updated_at = ? WHERE id = ?', [
    text,
    status,
    Date.now(),
    id,
  ]);
}

export async function setDedupeSignals(id: string, dedupeKey: string | null, ocrFingerprint: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET dedupe_key = ?, ocr_fingerprint = ?, updated_at = ? WHERE id = ?', [
    dedupeKey,
    ocrFingerprint,
    Date.now(),
    id,
  ]);
}

export async function setImageUri(id: string, imageUri: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET image_uri = ?, updated_at = ? WHERE id = ?', [imageUri, Date.now(), id]);
}

export async function setFields(id: string, fields: ReceiptFields, status: ReceiptStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET fields = ?, status = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(fields),
    status,
    Date.now(),
    id,
  ]);
}

export async function markDispatched(id: string, receiptId: string, fields: ReceiptFields): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    "UPDATE receipts SET fields = ?, local_ocr_text = NULL, status = 'extracted', receipt_id = ?, acked_at = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify(fields), receiptId, now, now, id],
  );
}

export async function markRetry(id: string, attempts: number, nextRetryAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET attempts = ?, next_retry_at = ?, updated_at = ? WHERE id = ?', [
    attempts,
    nextRetryAt,
    Date.now(),
    id,
  ]);
}

export async function markFinalFailure(id: string, status: ReceiptStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET status = ?, next_retry_at = 0, updated_at = ? WHERE id = ?', [
    status,
    Date.now(),
    id,
  ]);
}

export async function markExtractRetry(id: string, attempts: number, nextRetryAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE receipts SET status = 'llm_failed_retryable', attempts = ?, next_retry_at = ?, updated_at = ? WHERE id = ?",
    [attempts, nextRetryAt, Date.now(), id],
  );
}

export async function setStatus(id: string, status: ReceiptStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
}

export async function setSyncStatus(
  id: string,
  patch: Partial<Pick<ReceiptRow, 'imageSyncStatus' | 'resultSyncStatus'>>,
): Promise<void> {
  const db = await getDb();
  if (patch.imageSyncStatus && patch.resultSyncStatus) {
    await db.runAsync('UPDATE receipts SET image_sync_status = ?, result_sync_status = ?, updated_at = ? WHERE id = ?', [
      patch.imageSyncStatus,
      patch.resultSyncStatus,
      Date.now(),
      id,
    ]);
    return;
  }
  if (patch.imageSyncStatus) {
    await db.runAsync('UPDATE receipts SET image_sync_status = ?, updated_at = ? WHERE id = ?', [
      patch.imageSyncStatus,
      Date.now(),
      id,
    ]);
    return;
  }
  if (patch.resultSyncStatus) {
    await db.runAsync('UPDATE receipts SET result_sync_status = ?, updated_at = ? WHERE id = ?', [
      patch.resultSyncStatus,
      Date.now(),
      id,
    ]);
  }
}

/** Retake in One-click destroys an already-stored receipt — PM-confirmed. */
export async function remove(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM receipts WHERE id = ?', [id]);
}

export async function getById(id: string): Promise<ReceiptRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Persisted>('SELECT * FROM receipts WHERE id = ?', [id]);
  return r ? hydrate(r) : null;
}

export async function getByReceiptId(receiptId: string): Promise<ReceiptRow | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Persisted>('SELECT * FROM receipts WHERE receipt_id = ? ORDER BY created_at DESC LIMIT 1', [receiptId]);
  return r ? hydrate(r) : null;
}

/** Newest first — what the folder's carousel shows. */
export async function listRecent(limit = 20): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing') ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(hydrate);
}

export async function findLocalDuplicateCandidate(
  fields: ReceiptFields,
  input?: { userId?: string | null; ocrText?: string | null },
): Promise<LocalDuplicateCandidate | null> {
  const dedupeKey = buildDedupeKey(fields, input?.userId);
  if (!dedupeKey) return null;
  const db = await getDb();
  const currentFingerprint = buildOcrFingerprint(input?.ocrText);
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE dedupe_key = ? AND fields IS NOT NULL AND status NOT IN ('deleted', 'delete_pending') ORDER BY created_at DESC LIMIT 8",
    [dedupeKey],
  );
  for (const row of rows.map(hydrate)) {
    if (!row.fields) continue;
    const similarity = fingerprintSimilarity(currentFingerprint, row.ocrFingerprint);
    const merchantFallback = similarity === 0 && merchantsMatch(row.fields.store, fields.store);
    if (similarity < 0.55 && !merchantFallback) continue;
    return {
      matchedReceiptId: row.receiptId ?? row.id,
      matchedLocalRowId: row.id,
      matchedImageUri: row.imageUri,
      matchRule: similarity >= 0.55 ? 'local_dedupe_key_ocr_fingerprint' : 'local_dedupe_key_merchant_fallback',
      matchStrength: similarity >= 0.8 ? 'strong' : 'weak',
      merchant: row.fields.store,
      date: row.fields.date,
      currency: row.fields.currency,
      total: row.fields.total,
      fields: row.fields,
    };
  }
  return null;
}

/** Scans whose extraction never landed — the retry queue's work list. */
export async function listPendingExtract(): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status IN ('pending_extract', 'llm_failed_retryable', 'image_upload_pending') AND next_retry_at <= ? ORDER BY created_at ASC",
    [Date.now()],
  );
  return rows.map(hydrate);
}

/** Confirmed locally but not yet on the server — the sync queue's work list. */
export async function listUnsynced(): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status = 'confirmed_local' AND result_sync_status IN ('pending_sync', 'sync_failed') AND next_retry_at <= ? ORDER BY created_at ASC",
    [Date.now()],
  );
  return rows.map(hydrate);
}

/** Images from text-first Balanced captures that still need Supabase backup. */
export async function listPendingImageBackups(): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE image_sync_status IN ('pending_upload', 'upload_failed') AND next_retry_at <= ? ORDER BY created_at ASC",
    [Date.now()],
  );
  return rows.map(hydrate);
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM receipts WHERE status IN ('pending_extract', 'llm_failed_retryable', 'image_upload_pending', 'confirmed_local', 'result_sync_pending')",
  );
  return r?.n ?? 0;
}

/**
 * The locally cached scan balance. Plain SQLite, deliberately not secure
 * storage: this is not a secret and not the authority — the server re-checks
 * every scan, so a tampered value buys nothing but a camera that opens onto a
 * 402. `remaining: null` means unlimited.
 */
export type CachedQuota = { remaining: number | null; paywall: 'plus' | 'unlimited'; fetchedAt: number };

export async function getCachedQuota(userId: string): Promise<CachedQuota | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ remaining: number | null; paywall: string; fetched_at: number }>(
    'SELECT remaining, paywall, fetched_at FROM quota_cache WHERE user_id = ?',
    [userId],
  );
  if (!row) return null;
  return {
    remaining: row.remaining == null ? null : Number(row.remaining),
    paywall: row.paywall === 'unlimited' ? 'unlimited' : 'plus',
    fetchedAt: row.fetched_at,
  };
}

export async function setCachedQuota(
  userId: string,
  quota: { remaining: number | null; paywall: 'plus' | 'unlimited' },
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO quota_cache (user_id, remaining, paywall, fetched_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET remaining = excluded.remaining, paywall = excluded.paywall,
       fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    [userId, quota.remaining, quota.paywall, now, now],
  );
}

/** Optimistic decrement after a scan is accepted, so the next tap gates without a round trip. */
export async function decrementCachedQuota(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE quota_cache SET remaining = MAX(0, remaining - 1), updated_at = ? WHERE user_id = ? AND remaining IS NOT NULL',
    [Date.now(), userId],
  );
}

export async function enqueueCaptureMetric(payload: CaptureMetricsPayload): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO receipt_metric_queue (payload, attempts, next_retry_at, created_at, updated_at) VALUES (?, 0, ?, ?, ?)',
    [JSON.stringify(payload), now, now, now],
  );
}

export async function listQueuedCaptureMetrics(limit = 20): Promise<QueuedCaptureMetric[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MetricQueuePersisted>(
    'SELECT id, payload, attempts, next_retry_at FROM receipt_metric_queue WHERE next_retry_at <= ? ORDER BY created_at ASC LIMIT ?',
    [Date.now(), limit],
  );
  return rows.flatMap((row) => {
    try {
      return [{ id: row.id, payload: JSON.parse(row.payload) as CaptureMetricsPayload, attempts: row.attempts, nextRetryAt: row.next_retry_at }];
    } catch {
      return [];
    }
  });
}

export async function removeQueuedCaptureMetric(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM receipt_metric_queue WHERE id = ?', [id]);
}

export async function markCaptureMetricRetry(id: number, attempts: number, nextRetryAt: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipt_metric_queue SET attempts = ?, next_retry_at = ?, updated_at = ? WHERE id = ?', [
    attempts,
    nextRetryAt,
    Date.now(),
    id,
  ]);
}
