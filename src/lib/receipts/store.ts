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
import type { Tier } from '@/../packages/contracts/src/products';
import { normalizeReceiptItems } from '@/lib/receipts/types';

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
  const db = await SQLite.openDatabaseAsync(DB_NAME, {
    // expo-sqlite's default close cleanup also finalizes statements owned by
    // FTS5. FTS5 then finalizes the same statement while disconnecting its
    // virtual table, which crashes iOS during Fast Refresh/runtime teardown.
    // Our convenience queries finalize their own statements, so letting SQLite
    // own FTS teardown is both safe and required.
    finalizeUnusedStatementsBeforeClosing: false,
  });
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
      category_id INTEGER,
      server_revision INTEGER NOT NULL DEFAULT 0,
      server_updated_at TEXT,
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
    CREATE TABLE IF NOT EXISTS local_owner (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      user_id    TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      user_id     TEXT PRIMARY KEY NOT NULL,
      hydrated_at INTEGER,
      pull_cursor TEXT,
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      last_error TEXT,
      updated_at  INTEGER NOT NULL
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
    CREATE TABLE IF NOT EXISTS receipt_preferences (
      key        TEXT PRIMARY KEY NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
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
  await ensureColumn(db, 'category_id', 'ALTER TABLE receipts ADD COLUMN category_id INTEGER');
  await ensureColumn(db, 'server_revision', 'ALTER TABLE receipts ADD COLUMN server_revision INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'server_updated_at', 'ALTER TABLE receipts ADD COLUMN server_updated_at TEXT');
  await ensureColumn(db, 'acked_at', 'ALTER TABLE receipts ADD COLUMN acked_at INTEGER');
  // Where the image lives on the server. A row restored from the server has no
  // local file, so this is the only way back to its photo.
  await ensureColumn(db, 'remote_image_path', 'ALTER TABLE receipts ADD COLUMN remote_image_path TEXT');
  await ensureTableColumn(db, 'sync_state', 'last_attempt_at', 'ALTER TABLE sync_state ADD COLUMN last_attempt_at INTEGER');
  await ensureTableColumn(db, 'sync_state', 'last_success_at', 'ALTER TABLE sync_state ADD COLUMN last_success_at INTEGER');
  await ensureTableColumn(db, 'sync_state', 'last_error', 'ALTER TABLE sync_state ADD COLUMN last_error TEXT');
  await db.execAsync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS receipt_search_fts USING fts5(
      local_id UNINDEXED,
      merchant,
      notes,
      item_names,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS receipt_search_fts_insert AFTER INSERT ON receipts BEGIN
      INSERT INTO receipt_search_fts(local_id, merchant, notes, item_names)
      SELECT new.id,
        COALESCE(json_extract(new.fields, '$.store'), ''),
        COALESCE(json_extract(new.fields, '$.handwritten_notes'), ''),
        COALESCE((SELECT group_concat(json_extract(value, '$.name'), ' ')
          FROM json_each(json_extract(new.fields, '$.items'))), '')
      WHERE new.fields IS NOT NULL AND new.receipt_id IS NOT NULL
        AND new.status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing', 'delete_pending', 'deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS receipt_search_fts_update
    AFTER UPDATE OF fields, status, receipt_id ON receipts BEGIN
      DELETE FROM receipt_search_fts WHERE local_id = old.id;
      INSERT INTO receipt_search_fts(local_id, merchant, notes, item_names)
      SELECT new.id,
        COALESCE(json_extract(new.fields, '$.store'), ''),
        COALESCE(json_extract(new.fields, '$.handwritten_notes'), ''),
        COALESCE((SELECT group_concat(json_extract(value, '$.name'), ' ')
          FROM json_each(json_extract(new.fields, '$.items'))), '')
      WHERE new.fields IS NOT NULL AND new.receipt_id IS NOT NULL
        AND new.status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing', 'delete_pending', 'deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS receipt_search_fts_delete AFTER DELETE ON receipts BEGIN
      DELETE FROM receipt_search_fts WHERE local_id = old.id;
    END;
  `);
  const indexed = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM receipt_search_fts');
  const searchable = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM receipts WHERE fields IS NOT NULL AND receipt_id IS NOT NULL AND status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing', 'delete_pending', 'deleted')",
  );
  if ((indexed?.n ?? 0) !== (searchable?.n ?? 0)) {
    await db.withTransactionAsync(async () => {
      await db.execAsync('DELETE FROM receipt_search_fts');
      await db.execAsync(`
        INSERT INTO receipt_search_fts(local_id, merchant, notes, item_names)
        SELECT r.id, COALESCE(json_extract(r.fields, '$.store'), ''),
          COALESCE(json_extract(r.fields, '$.handwritten_notes'), ''),
          COALESCE((SELECT group_concat(json_extract(value, '$.name'), ' ')
            FROM json_each(json_extract(r.fields, '$.items'))), '')
        FROM receipts r WHERE r.fields IS NOT NULL AND r.receipt_id IS NOT NULL
          AND r.status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing', 'delete_pending', 'deleted');
      `);
    });
  }
  // category_id/revision were added after the original mirror shipped. A
  // cursor-only pull would never revisit older rows, so invalidate hydration
  // exactly once and let the normal full pull backfill their metadata.
  const metadataVersion = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM receipt_preferences WHERE key = 'sync.metadata_version'",
  );
  if (metadataVersion?.value !== '2') {
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      await db.execAsync('UPDATE sync_state SET hydrated_at = NULL, pull_cursor = NULL');
      await db.runAsync(
        `INSERT INTO receipt_preferences(key, value, updated_at) VALUES ('sync.metadata_version', '2', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [now],
      );
    });
  }
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_receipts_dedupe ON receipts (dedupe_key, created_at DESC)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_receipts_duplicate_of ON receipts (duplicate_of, created_at DESC)');
  return db;
}

async function ensureColumn(db: SQLite.SQLiteDatabase, name: string, sql: string): Promise<void> {
  return ensureTableColumn(db, 'receipts', name, sql);
}

async function ensureTableColumn(
  db: SQLite.SQLiteDatabase,
  table: 'receipts' | 'sync_state',
  name: string,
  sql: string,
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((column) => column.name === name)) await db.execAsync(sql);
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

/** Batch mirror writes into one WAL commit during hydration/delta pulls. */
export async function runInTransaction(task: () => Promise<void>): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(task);
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
  category_id: number | null;
  server_revision: number;
  server_updated_at: string | null;
  acked_at: number | null;
  remote_image_path: string | null;
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
  fields: r.fields
    ? (() => {
        const fields = JSON.parse(r.fields) as ReceiptFields;
        return { ...fields, items: normalizeReceiptItems(fields.items) };
      })()
    : null,
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
  categoryId: r.category_id,
  serverRevision: r.server_revision,
  serverUpdatedAt: r.server_updated_at,
  ackedAt: r.acked_at,
  remoteImagePath: r.remote_image_path ?? null,
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
    categoryId: null,
    serverRevision: 0,
    serverUpdatedAt: null,
    ackedAt: null,
    remoteImagePath: null,
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

/**
 * Extraction landed. `attempts` and `next_retry_at` are reset because one pair
 * of columns serves both queues: without this, a scan that needed three
 * extract retries would start its confirm backoff already three deep, and used
 * to inherit those attempts against the confirm retry budget too.
 */
export async function markDispatched(id: string, receiptId: string, fields: ReceiptFields): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    "UPDATE receipts SET fields = ?, local_ocr_text = NULL, status = 'extracted', receipt_id = ?, acked_at = ?, attempts = 0, next_retry_at = 0, updated_at = ? WHERE id = ?",
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

export async function markProviderDelayed(id: string, attempts = 0): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE receipts SET status = 'provider_delayed', attempts = ?, next_retry_at = 0, updated_at = ? WHERE id = ?",
    [attempts, Date.now(), id],
  );
}

export async function setServerReceipt(id: string, receiptId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET receipt_id = ?, acked_at = COALESCE(acked_at, ?), updated_at = ? WHERE id = ?', [
    receiptId,
    Date.now(),
    Date.now(),
    id,
  ]);
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

/**
 * Restore-from-server support.
 *
 * The app has no continuous pull — one device writes, the server records. What
 * it does need is a way back after a reinstall, and this is the local half of
 * that: a marker so the restore runs once, and an upsert keyed by the id the
 * device minted in the first place (`receipts.capture_id` server-side), so a
 * restored row lands under the key it had before.
 *
 * `pull_cursor` is unused today. It exists so that adding a delta pull later —
 * if this ever becomes multi-device — needs no local migration.
 */
/**
 * Which account the local receipts belong to.
 *
 * Rows in `receipts` carry no user id — the device has always assumed one
 * account — so signing out and signing in as someone else showed the previous
 * user's receipts. This is the marker that makes that detectable. It survives
 * sign-out deliberately: the receipts do too, and a user signing back into
 * their own account must not lose captures that never made it up.
 */
export async function getLocalOwner(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM local_owner WHERE id = 1');
  return row?.user_id ?? null;
}

export async function setLocalOwner(userId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO local_owner (id, user_id, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at`,
    [userId, now],
  );
}

/** Every local image path, so the files can go when their rows do. */
export async function listAllImageUris(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ image_uri: string }>(
    "SELECT image_uri FROM receipts WHERE image_uri IS NOT NULL AND image_uri <> ''",
  );
  return rows.map((row) => row.image_uri);
}

/** Drop every receipt and the restore markers. Only for an account switch. */
export async function clearReceiptData(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM receipts; DELETE FROM sync_state; DELETE FROM receipt_metric_queue;');
}

export type SyncState = {
  hydratedAt: number | null;
  pullCursor: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
};

export async function isLocalSearchReady(userId: string): Promise<boolean> {
  const [owner, state] = await Promise.all([getLocalOwner(), getSyncState(userId)]);
  return owner === userId && state?.hydratedAt != null;
}

export async function getSyncState(userId: string): Promise<SyncState | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    hydrated_at: number | null;
    pull_cursor: string | null;
    last_attempt_at: number | null;
    last_success_at: number | null;
    last_error: string | null;
  }>(
    'SELECT hydrated_at, pull_cursor, last_attempt_at, last_success_at, last_error FROM sync_state WHERE user_id = ?',
    [userId],
  );
  if (!row) return null;
  return {
    hydratedAt: row.hydrated_at,
    pullCursor: row.pull_cursor,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
  };
}

export async function markSyncAttempt(userId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO sync_state(user_id, last_attempt_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
       last_error = NULL, updated_at = excluded.updated_at`,
    [userId, now, now],
  );
}

export async function markSyncFailed(userId: string, message: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO sync_state(user_id, last_attempt_at, last_error, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
       last_error = excluded.last_error, updated_at = excluded.updated_at`,
    [userId, now, message.slice(0, 1000), now],
  );
}

/**
 * A local row is the authority on itself until the server has acknowledged it.
 * Anything short of fully settled is either mid-flight or holds user work that
 * has not gone up yet, and a pull must not overwrite it — that is how a
 * background sync eats somebody's edit.
 */
export function hasUnsyncedLocalWork(row: ReceiptRow): boolean {
  if (row.status === 'provider_delayed' || row.status === 'llm_failed_final') return false;
  return !(row.status === 'synced' && row.resultSyncStatus === 'synced');
}

export async function setPullCursor(userId: string, cursor: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO sync_state (user_id, hydrated_at, pull_cursor, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET pull_cursor = excluded.pull_cursor,
       hydrated_at = COALESCE(sync_state.hydrated_at, excluded.hydrated_at),
       updated_at = excluded.updated_at`,
    [userId, now, cursor, now],
  );
}

/** Overwrite a settled row with the server's version. */
export async function updateFromServer(row: RestoredReceipt): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE receipts SET status = ?, fields = ?, receipt_id = ?, category_id = ?, server_revision = ?,
      server_updated_at = ?, remote_image_path = ?, updated_at = ?
      WHERE id = ?`,
    [row.status, JSON.stringify(row.fields), row.receiptId, row.categoryId, row.serverRevision,
      row.serverUpdatedAt, row.remoteImagePath, Date.now(), row.captureId],
  );
}

/** Refresh concurrency/filter metadata without touching protected local fields. */
export async function updateServerMetadata(
  captureId: string,
  categoryId: number | null,
  serverRevision: number,
  serverUpdatedAt: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE receipts SET category_id = ?, server_revision = ?, server_updated_at = ?, updated_at = ?
     WHERE id = ?`,
    [categoryId, serverRevision, serverUpdatedAt, Date.now(), captureId],
  );
}

export async function setHydrated(userId: string, cursor: string | null): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO sync_state (user_id, hydrated_at, pull_cursor, last_attempt_at, last_success_at, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET hydrated_at = excluded.hydrated_at,
       pull_cursor = excluded.pull_cursor, last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at, last_error = NULL, updated_at = excluded.updated_at`,
    [userId, now, cursor, now, now, now],
  );
}

export async function countReceipts(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM receipts');
  return row?.n ?? 0;
}

export type RestoredReceipt = {
  captureId: string;
  receiptId: string;
  status: ReceiptStatus;
  fields: ReceiptFields;
  remoteImagePath: string | null;
  categoryId: number | null;
  serverRevision: number;
  serverUpdatedAt: string;
  createdAt: number;
};

/**
 * Write a receipt that came from the server. Idempotent on the capture id, and
 * it never overwrites a row this device already has — anything local is either
 * newer or still on its way up, and the whole point of the outbox is that
 * un-acked local work wins.
 */
export async function upsertRestored(row: RestoredReceipt): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO receipts (id, image_uri, capture_mode, extraction_mode, status, fields,
       image_sync_status, result_sync_status, attempts, next_retry_at, receipt_id, acked_at,
       remote_image_path, category_id, server_revision, server_updated_at, created_at, updated_at)
     VALUES (?, '', 'default', 'balanced', ?, ?, ?, 'synced', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      row.captureId,
      row.status,
      JSON.stringify(row.fields),
      row.remoteImagePath ? 'uploaded' : 'missing_local_file',
      row.receiptId,
      now,
      row.remoteImagePath,
      row.categoryId,
      row.serverRevision,
      row.serverUpdatedAt,
      row.createdAt,
      now,
    ],
  );
}

/** Newest first — what the folder's carousel shows. */
export async function listRecent(limit = 20): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing', 'delete_pending', 'deleted') ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(hydrate);
}

export type LocalSearchResult = { row: ReceiptRow; rank: number };

const toFtsQuery = (text: string): string | null => {
  const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.length ? tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ') : null;
};

/** Indexed, parameterized search over the hydrated local mirror. */
export async function searchReceipts(query: {
  text?: string;
  date_from?: string;
  date_to?: string;
  category_ids?: number[];
  amount_min?: number;
  amount_max?: number;
  amount_currency?: string;
  limit?: number;
}): Promise<LocalSearchResult[]> {
  const db = await getDb();
  const clauses = [
    "r.fields IS NOT NULL",
    "r.receipt_id IS NOT NULL",
    "r.status NOT IN ('pending_extract', 'local_captured', 'local_ocr_processing', 'delete_pending', 'deleted')",
  ];
  const params: SQLite.SQLiteBindParams = {};
  const fts = query.text ? toFtsQuery(query.text) : null;
  if (fts) {
    clauses.push('receipt_search_fts MATCH $fts');
    params.$fts = fts;
  }
  if (query.date_from) { clauses.push("json_extract(r.fields, '$.date') >= $dateFrom"); params.$dateFrom = query.date_from; }
  if (query.date_to) { clauses.push("json_extract(r.fields, '$.date') <= $dateTo"); params.$dateTo = query.date_to; }
  if (query.amount_currency) { clauses.push("json_extract(r.fields, '$.currency') = $currency"); params.$currency = query.amount_currency; }
  if (query.amount_min !== undefined) { clauses.push("CAST(json_extract(r.fields, '$.total') AS REAL) >= $amountMin"); params.$amountMin = query.amount_min; }
  if (query.amount_max !== undefined) { clauses.push("CAST(json_extract(r.fields, '$.total') AS REAL) <= $amountMax"); params.$amountMax = query.amount_max; }
  if (query.category_ids?.length) {
    const names = query.category_ids.map((_, index) => `$category${index}`);
    clauses.push(`r.category_id IN (${names.join(', ')})`);
    query.category_ids.forEach((id, index) => { params[`$category${index}`] = id; });
  }
  params.$limit = Math.min(Math.max(query.limit ?? 200, 1), 200);
  const rank = fts ? 'bm25(receipt_search_fts, 0, 10, 4, 6)' : '0';
  const join = fts ? 'JOIN receipt_search_fts ON receipt_search_fts.local_id = r.id' : '';
  const order = fts
    ? "rank ASC, json_extract(r.fields, '$.date') DESC, r.created_at DESC"
    : "json_extract(r.fields, '$.date') DESC, r.created_at DESC";
  const rows = await db.getAllAsync<Persisted & { search_rank: number }>(
    `SELECT r.*, ${rank} AS search_rank FROM receipts r ${join}
     WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT $limit`, params,
  );
  return rows.map((row) => ({ row: hydrate(row), rank: Number(row.search_rank) || 0 }));
}

export async function updateManagedFields(
  id: string,
  fields: ReceiptFields,
  categoryId?: number,
  serverRevision?: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET fields = ?, category_id = COALESCE(?, category_id), server_revision = COALESCE(?, server_revision), result_sync_status = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(fields),
    categoryId ?? null,
    serverRevision ?? null,
    'synced',
    Date.now(),
    id,
  ]);
}

export async function markManagedDeleted(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE receipts SET status = 'deleted', updated_at = ? WHERE id = ?", [Date.now(), id]);
}

export async function restoreManagedReceipt(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE receipts SET status = 'synced', updated_at = ? WHERE id = ?", [Date.now(), id]);
}

const RECEIPT_VIEW_KEY = 'search.view';

export async function getReceiptViewPreference(): Promise<'card' | 'list'> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM receipt_preferences WHERE key = ?', [RECEIPT_VIEW_KEY]);
  return row?.value === 'list' ? 'list' : 'card';
}

export async function setReceiptViewPreference(view: 'card' | 'list'): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO receipt_preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [RECEIPT_VIEW_KEY, view, Date.now()],
  );
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

  // OCR drafts are intentionally cheap and can misread the merchant or date,
  // which makes the strict dedupe key miss the exact same paper. A very high
  // token-fingerprint match is still sufficient to warn before a model call;
  // keep the threshold high because this fallback is broader than the key.
  if (currentFingerprint && parseFingerprint(currentFingerprint).length > 0) {
    const fingerprintRows = await db.getAllAsync<Persisted>(
      "SELECT * FROM receipts WHERE ocr_fingerprint IS NOT NULL AND fields IS NOT NULL AND status NOT IN ('deleted', 'delete_pending') ORDER BY created_at DESC LIMIT 20",
    );
    for (const row of fingerprintRows.map(hydrate)) {
      if (!row.fields) continue;
      const similarity = fingerprintSimilarity(currentFingerprint, row.ocrFingerprint);
      if (similarity < 0.9) continue;
      return {
        matchedReceiptId: row.receiptId ?? row.id,
        matchedLocalRowId: row.id,
        matchedImageUri: row.imageUri,
        matchRule: 'local_ocr_fingerprint',
        matchStrength: 'strong',
        merchant: row.fields.store,
        date: row.fields.date,
        currency: row.fields.currency,
        total: row.fields.total,
        fields: row.fields,
      };
    }
  }
  return null;
}

/**
 * Put a blocked or permanently failed capture back in the queue.
 *
 * llm_failed_retryable rather than pending_extract, which is the obvious choice
 * and the wrong one: listRecent hides pending_extract, so requeueing to it made
 * the row disappear from Search the instant the user asked to retry it — the
 * one thing this whole change exists to prevent. This status is in the drain's
 * work list, stays visible as "Waiting to retry", and is one of the statuses
 * Search polls, so the row visibly settles rather than blinking out.
 */
export async function requeueForExtract(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE receipts SET status = 'llm_failed_retryable', attempts = 0, next_retry_at = 0, updated_at = ? WHERE id = ?",
    [Date.now(), id],
  );
}

/**
 * Captures the user can still act on but hasn't, past their keep-by date.
 *
 * Keeping a blocked capture's photo is what makes it recoverable, and is also
 * why something has to expire it — otherwise the capture directory grows
 * forever for anyone who never upgrades. Returned rather than deleted here so
 * the caller can remove the files too.
 */
export async function listAbandoned(olderThanMs: number): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status IN ('blocked_quota', 'llm_failed_final') AND updated_at <= ? ORDER BY updated_at ASC",
    [Date.now() - olderThanMs],
  );
  return rows.map(hydrate);
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

/**
 * Return rows stranded mid-flight to their queue.
 *
 * Both queues mark a row `syncing`/`uploading` before the network call, and
 * neither work list selects those states — so anything that does not survive
 * the request (app backgrounded, process killed, a request that never settles)
 * sat there forever, with no error recorded and the receipt still looking saved
 * on the device. The staleness window is what keeps this from interrupting a
 * request that is genuinely still running.
 */
export async function reclaimStalledSyncs(staleMs: number): Promise<number> {
  const db = await getDb();
  const cutoff = Date.now() - staleMs;
  const results = await Promise.all([
    db.runAsync(
      "UPDATE receipts SET result_sync_status = 'pending_sync', updated_at = ? WHERE result_sync_status = 'syncing' AND updated_at < ?",
      [Date.now(), cutoff],
    ),
    db.runAsync(
      "UPDATE receipts SET image_sync_status = 'pending_upload', updated_at = ? WHERE image_sync_status = 'uploading' AND updated_at < ?",
      [Date.now(), cutoff],
    ),
  ]);
  return results.reduce((total, result) => total + (result.changes ?? 0), 0);
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

/**
 * Put a permanently failed image upload back in the backup queue.
 *
 * `upload_failed_final` is deliberately outside listPendingImageBackups' work
 * list — five attempts have already failed and an automatic sixth would just
 * spin. But under DL-002 the device is the only holder of that photo until the
 * upload lands, so the state has to be escapable by hand. Attempts reset to
 * zero because this is a fresh decision by the user, not a continuation of the
 * run that gave up.
 */
export async function requeueImageBackup(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE receipts SET image_sync_status = 'pending_upload', attempts = 0, next_retry_at = 0, updated_at = ? WHERE id = ? AND image_sync_status = 'upload_failed_final'",
    [Date.now(), id],
  );
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
    "SELECT COUNT(*) AS n FROM receipts WHERE status IN ('pending_extract', 'llm_failed_retryable', 'provider_delayed', 'image_upload_pending', 'confirmed_local', 'result_sync_pending')",
  );
  return r?.n ?? 0;
}

/** Server-owned B5 jobs are completed by the sweeper, not the local dispatcher. */
export async function countProviderDelayed(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM receipts WHERE status = 'provider_delayed'",
  );
  return row?.n ?? 0;
}

/**
 * The locally cached scan balance. Plain SQLite, deliberately not secure
 * storage: this is not a secret and not the authority — the server re-checks
 * every scan, so a tampered value buys nothing but a camera that opens onto a
 * 402. `remaining: null` means unlimited.
 */
export type CachedQuota = { remaining: number | null; paywall: Tier; fetchedAt: number };

export async function getCachedQuota(userId: string): Promise<CachedQuota | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ remaining: number | null; paywall: string; fetched_at: number }>(
    'SELECT remaining, paywall, fetched_at FROM quota_cache WHERE user_id = ?',
    [userId],
  );
  if (!row) return null;
  return {
    remaining: row.remaining == null ? null : Number(row.remaining),
    // A row written by a build that predates the Pro/Max rename holds 'plus' or
    // 'unlimited'; both map forward rather than being discarded, so an upgrade
    // does not silently reset every user's cached balance.
    paywall: row.paywall === 'max' || row.paywall === 'unlimited' ? 'max' : 'pro',
    fetchedAt: row.fetched_at,
  };
}

export async function setCachedQuota(
  userId: string,
  quota: { remaining: number | null; paywall: Tier },
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
