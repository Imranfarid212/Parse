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

import type { ReceiptFields, ReceiptRow, ReceiptStatus } from '@/lib/receipts/types';

const DB_NAME = 'parse.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS receipts (
      id         TEXT PRIMARY KEY NOT NULL,
      image_uri  TEXT NOT NULL,
      status     TEXT NOT NULL,
      fields     TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_status  ON receipts (status);
    CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts (created_at DESC);
  `);
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

type Persisted = {
  id: string;
  image_uri: string;
  status: ReceiptStatus;
  fields: string | null;
  created_at: number;
  updated_at: number;
};

const hydrate = (r: Persisted): ReceiptRow => ({
  id: r.id,
  imageUri: r.image_uri,
  status: r.status,
  fields: r.fields ? (JSON.parse(r.fields) as ReceiptFields) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Ids only need to be unique on-device; the server assigns its own. */
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Called the moment the shutter fires — before /extract is even attempted. */
export async function insertCaptured(imageUri: string): Promise<ReceiptRow> {
  const db = await getDb();
  const now = Date.now();
  const row: ReceiptRow = {
    id: newId(),
    imageUri,
    status: 'pending_extract',
    fields: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.runAsync(
    'INSERT INTO receipts (id, image_uri, status, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [row.id, row.imageUri, row.status, null, now, now],
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
    "SELECT * FROM receipts WHERE status = 'pending_extract' ORDER BY created_at ASC",
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
