/**
 * Keep the device's receipts in step with the server's.
 *
 * The local database is what every offline decision reads — the shutter gate,
 * duplicate detection, totals — so it is only as trustworthy as its agreement
 * with the server. The app's writes go up through the outbox; this is the other
 * direction, and it exists so that agreement is maintained rather than assumed.
 *
 * "The device is the only writer" is nearly true and will stop being true: a
 * retention purge deletes rows nobody on the device asked to delete, and an
 * account teardown does the same. Without a pull, the app would keep showing,
 * exporting and totalling receipts the server has already destroyed.
 *
 * How it works:
 *
 *   - A cursor of the newest `updated_at` already seen. The first pass has no
 *     cursor and takes everything, which is also what a reinstall needs, so
 *     restore and steady-state sync are the same code path.
 *   - The fetch is `>=` the cursor rather than `>`, so rows sharing a timestamp
 *     cannot fall through the gap. Re-seeing a row is harmless because applying
 *     one is idempotent.
 *   - Soft-deleted rows come back too, and become local deletions. A pull that
 *     only inserts is not a mirror; it can never let go of anything.
 *   - The cursor advances only over rows that were actually applied, so an
 *     interrupted pass resumes rather than skips.
 *
 * The conflict rule is deliberately blunt: **un-acked local work always wins.**
 * A row is overwritten by the server only when it is fully settled. Anything
 * mid-flight, awaiting review, or confirmed-but-not-yet-pushed is left alone,
 * because the device is the only place that version exists.
 */
import type { Category } from '@/../packages/contracts/src/types';
import { supabase } from '@/lib/auth/supabase';
import {
  clearForeignLocalReceipts,
  clearLocalReceiptsForAccountSwitch,
  deleteLocalReceipt,
} from '@/lib/receipts/capture';
import * as store from '@/lib/receipts/store';
import { CATEGORIES, isCategory, type ReceiptFields, type ReceiptLineItem, type ReceiptStatus } from '@/lib/receipts/types';

const PAGE_SIZE = 200;
/** Guard against an unbounded loop if the server keeps handing back full pages. */
const MAX_PAGES = 50;

type ServerItem = { name: string | null; qty: number | string | null; amount: number | string | null };
type ServerReceipt = {
  id: string;
  capture_id: string;
  merchant: string | null;
  txn_date: string | null;
  currency: string | null;
  total: number | string | null;
  category_id: number | null;
  notes: string | null;
  image_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number | null;
  receipt_items: ServerItem[] | null;
};

export type SyncResult = { added: number; updated: number; deleted: number; skipped: number };

/**
 * The server stores line items structured and the device carries them as plain
 * text, so this matches the formatting the extract client already applies — a
 * synced receipt should read exactly like a scanned one.
 */
const toItems = (items: ServerItem[] | null): ReceiptLineItem[] =>
  (items ?? []).map((item) => ({ name: item.name?.trim() || 'Item', qty: Number(item.qty) > 0 ? Number(item.qty) : 1, amount: Math.max(0, Number(item.amount) || 0) }));

/** Server `status` is its own vocabulary; map it onto the device's. */
const toLocalStatus = (status: string): ReceiptStatus => {
  if (status === 'confirmed') return 'synced';
  if (status === 'processing') return 'provider_delayed';
  if (status === 'failed') return 'llm_failed_final';
  return 'extracted';
};

function toFields(row: ServerReceipt, categoryNameById: Map<number, string>): ReceiptFields {
  const categoryName = row.category_id === null ? null : categoryNameById.get(row.category_id) ?? null;
  return {
    date: row.txn_date,
    store: row.merchant ?? '',
    items: toItems(row.receipt_items),
    currency: /^[A-Z]{3}$/.test(row.currency ?? '') ? (row.currency as string) : 'USD',
    total: Number(row.total) || 0,
    category: isCategory(categoryName) ? categoryName : CATEGORIES[CATEGORIES.length - 1],
    handwritten_notes: row.notes ?? '',
  };
}

async function applyRow(
  row: ServerReceipt,
  categoryNameById: Map<number, string>,
  result: SyncResult,
): Promise<boolean> {
  const existing = await store.getById(row.capture_id);
  const localCategoryId = existing?.fields
    ? [...categoryNameById.entries()].find(([, name]) => name === existing.fields?.category)?.[0] ?? row.category_id
    : row.category_id;

  if (row.deleted_at) {
    // Gone on the server. If the device still has unsent work on it, keep the
    // row — pushing it will fail against a deleted receipt and surface then,
    // which is better than destroying something the user cannot get back.
    if (existing && store.hasUnsyncedLocalWork(existing)) {
      await store.updateServerMetadata(row.capture_id, localCategoryId, Number(row.revision) || 0, row.updated_at);
      result.skipped += 1;
      return false;
    }
    if (existing) {
      await deleteLocalReceipt(row.capture_id);
      result.deleted += 1;
    }
    return true;
  }

  const restored = {
    captureId: row.capture_id,
    receiptId: row.id,
    status: toLocalStatus(row.status),
    fields: toFields(row, categoryNameById),
    remoteImagePath: row.image_path,
    categoryId: row.category_id,
    serverRevision: Number(row.revision) || 0,
    serverUpdatedAt: row.updated_at,
    createdAt: Date.parse(row.created_at) || Date.now(),
  };

  if (!existing) {
    await store.upsertRestored(restored);
    result.added += 1;
    return true;
  }

  if (store.hasUnsyncedLocalWork(existing)) {
    await store.updateServerMetadata(row.capture_id, localCategoryId, Number(row.revision) || 0, row.updated_at);
    result.skipped += 1;
    return false;
  }

  await store.updateFromServer(restored);
  result.updated += 1;
  return true;
}

/**
 * Pull everything that changed since the last pass. Safe to call on launch, on
 * reconnect and on foreground; a pass with nothing to do costs one query.
 */
async function runSyncFromServer(userId: string, categories: Category[]): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, deleted: 0, skipped: 0 };
  await store.markSyncAttempt(userId);

  // Decide who this device's local store belongs to before reading a row of it.
  //
  // Three cases, and the middle one used to be wrong. It read
  //
  //   if (owner && owner !== userId) await clearLocalReceiptsForAccountSwitch();
  //
  // which treats "nobody is recorded as the owner" as "nothing to protect" and
  // then claims the store for the incoming user — handing them whatever rows
  // were already sitting there. An absent owner is not evidence of an empty
  // store; it is the absence of evidence either way, and the only safe reading
  // of rows whose provenance cannot be established is that they are not ours.
  const owner = await store.getLocalOwner();
  if (owner === userId) {
    // Ours already. Rows left NULL by an upgrade are ours too — local_owner is
    // exactly the assurance that this device is this account's.
    const adopted = await store.adoptUnownedReceipts(userId);
    if (adopted > 0 && __DEV__) console.warn(`[sync] stamped ${adopted} pre-existing local receipt(s)`);
  } else if (owner !== null) {
    // A genuine account switch: a different user is recorded as the owner, so
    // everything here — rows, images, queued metrics — belongs to them.
    await clearLocalReceiptsForAccountSwitch();
    await store.setLocalOwner(userId);
  } else {
    // No owner recorded. Anything already stamped for this user is theirs (a
    // capture can beat this claim); anything else cannot be accounted for and
    // goes. This is the case that previously fell through and handed the whole
    // store to whoever signed in next.
    await clearForeignLocalReceipts(userId);
    await store.setLocalOwner(userId);
  }

  const state = await store.getSyncState(userId);
  const cursor = owner === userId ? state?.pullCursor ?? null : null;
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  let newestSeen = cursor;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    let query = supabase
      .from('receipts')
      .select(
        'id,capture_id,merchant,txn_date,currency,total,category_id,notes,image_path,status,created_at,updated_at,deleted_at,revision,receipt_items(name,qty,amount)',
      )
      .eq('user_id', userId)
      .order('updated_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (cursor) query = query.gte('updated_at', cursor);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as ServerReceipt[];
    if (rows.length === 0) break;

    await store.runInTransaction(async () => {
      for (const row of rows) {
        if (!row.capture_id || !row.id) continue;
        await applyRow(row, categoryNameById, result);
        // A skipped row is still represented locally; its unsent version is the
        // intentional winner. When that version is pushed, the server receives
        // a newer updated_at/revision and re-enters a later delta window.
        if (!newestSeen || row.updated_at > newestSeen) newestSeen = row.updated_at;
      }
    });

    if (rows.length < PAGE_SIZE) break;
  }

  // Advanced only over rows actually applied, so an interrupted pass resumes
  // from where it stopped rather than skipping the remainder.
  // Hydration means every active server row is represented, not that the
  // server overwrote unsent local work. Advancing is safe for skipped drafts:
  // their eventual push creates a newer server revision and delta timestamp.
  await store.setHydrated(userId, newestSeen);
  return result;
}

const inFlight = new Map<string, Promise<SyncResult>>();

/** Coalesce launch, foreground and realtime pulls for the same account. */
export function syncFromServer(userId: string, categories: Category[]): Promise<SyncResult> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const task = runSyncFromServer(userId, categories)
    .catch(async (cause: unknown) => {
      const message = cause instanceof Error
        ? cause.message
        : typeof cause === 'object' && cause !== null
          ? JSON.stringify(cause)
          : String(cause);
      await store.markSyncFailed(userId, message);
      throw cause;
    })
    .finally(() => inFlight.delete(userId));
  inFlight.set(userId, task);
  return task;
}
