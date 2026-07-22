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

import type { CaptureMode, ReceiptFields, ReceiptRow, ReceiptStatus } from '@/lib/receipts/types';

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
      status     TEXT NOT NULL,
      fields     TEXT,
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
  `);
  await ensureColumn(db, 'capture_mode', "ALTER TABLE receipts ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'default'");
  await ensureColumn(db, 'attempts', 'ALTER TABLE receipts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'next_retry_at', 'ALTER TABLE receipts ADD COLUMN next_retry_at INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'receipt_id', 'ALTER TABLE receipts ADD COLUMN receipt_id TEXT');
  await ensureColumn(db, 'acked_at', 'ALTER TABLE receipts ADD COLUMN acked_at INTEGER');
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
  status: ReceiptStatus;
  fields: string | null;
  attempts: number;
  next_retry_at: number;
  receipt_id: string | null;
  acked_at: number | null;
  created_at: number;
  updated_at: number;
};

const hydrate = (r: Persisted): ReceiptRow => ({
  id: r.id,
  imageUri: r.image_uri,
  captureMode: r.capture_mode,
  status: r.status,
  fields: r.fields ? (JSON.parse(r.fields) as ReceiptFields) : null,
  attempts: r.attempts,
  nextRetryAt: r.next_retry_at,
  receiptId: r.receipt_id,
  ackedAt: r.acked_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

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
  captureId = newCaptureId(),
): Promise<ReceiptRow> {
  const db = await getDb();
  const now = Date.now();
  const row: ReceiptRow = {
    id: captureId,
    imageUri,
    captureMode,
    status: 'pending_extract',
    fields: null,
    attempts: 0,
    nextRetryAt: now,
    receiptId: null,
    ackedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.runAsync(
    'INSERT INTO receipts (id, image_uri, capture_mode, status, fields, attempts, next_retry_at, receipt_id, acked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [row.id, row.imageUri, row.captureMode, row.status, null, row.attempts, row.nextRetryAt, null, null, now, now],
  );
  return row;
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
    "UPDATE receipts SET fields = ?, status = 'extracted', receipt_id = ?, acked_at = ?, updated_at = ? WHERE id = ?",
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

export async function setStatus(id: string, status: ReceiptStatus): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receipts SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
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

/** Newest first — what the folder's carousel shows. */
export async function listRecent(limit = 20): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status != 'pending_extract' ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(hydrate);
}

/** Scans whose extraction never landed — the retry queue's work list. */
export async function listPendingExtract(): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status = 'pending_extract' AND next_retry_at <= ? ORDER BY created_at ASC",
    [Date.now()],
  );
  return rows.map(hydrate);
}

/** Confirmed locally but not yet on the server — the sync queue's work list. */
export async function listUnsynced(): Promise<ReceiptRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Persisted>(
    "SELECT * FROM receipts WHERE status = 'confirmed_local' ORDER BY created_at ASC",
  );
  return rows.map(hydrate);
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM receipts WHERE status IN ('pending_extract', 'confirmed_local')",
  );
  return r?.n ?? 0;
}
