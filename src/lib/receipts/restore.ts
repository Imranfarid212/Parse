/**
 * Restore a user's receipts onto a device that has never seen them.
 *
 * Parse is single-device: the phone writes, the server records, and nothing
 * pulls down continuously. The one case that genuinely needs the other
 * direction is a reinstall or a replacement phone, where the server holds
 * every receipt and the app would otherwise open to an empty list.
 *
 * Because it only ever runs against an empty local database, this is a plain
 * one-shot fetch — no cursor, no tombstones, no conflict resolution. It is
 * still written as an idempotent upsert over pages so that adding a delta pull
 * later is the same function with a `since` argument rather than a rewrite.
 *
 * It deliberately does not download images. Nothing renders them today, they
 * are the bulk of the bytes, and a receipt's figures are what the user needs
 * back; the storage path is kept on each row so a viewer can fetch one later.
 *
 * A failure here is silent by design. The app works without it — the user just
 * sees the list they would have seen anyway — and it retries on the next
 * launch because the marker is only written after a clean pass.
 */
import type { Category } from '@/../packages/contracts/src/types';
import { supabase } from '@/lib/auth/supabase';
import { clearLocalReceiptsForAccountSwitch } from '@/lib/receipts/capture';
import * as store from '@/lib/receipts/store';
import { CATEGORIES, isCategory, type ReceiptFields, type ReceiptStatus } from '@/lib/receipts/types';

const PAGE_SIZE = 200;
/** Guard against an unbounded loop if the server keeps handing back full pages. */
const MAX_PAGES = 50;

type ServerItem = { name: string | null; amount: number | string | null };
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
  receipt_items: ServerItem[] | null;
};

/**
 * The server stores line items structured and the device carries them as
 * plain text, so this matches the formatting the extract client already
 * applies — a restored receipt should read exactly like a scanned one.
 */
const toItemLines = (items: ServerItem[] | null): string[] =>
  (items ?? []).map((item) => `${item.name ?? ''}  ${(Number(item.amount) || 0).toFixed(2)}`);

/** Server `status` is its own vocabulary; map it onto the device's. */
function toLocalStatus(status: string): ReceiptStatus {
  return status === 'confirmed' ? 'synced' : 'extracted';
}

function toFields(row: ServerReceipt, categoryNameById: Map<number, string>): ReceiptFields {
  const categoryName = row.category_id === null ? null : categoryNameById.get(row.category_id) ?? null;
  return {
    date: row.txn_date,
    store: row.merchant ?? '',
    items: toItemLines(row.receipt_items),
    currency: /^[A-Z]{3}$/.test(row.currency ?? '') ? (row.currency as string) : 'USD',
    total: Number(row.total) || 0,
    category: isCategory(categoryName) ? categoryName : CATEGORIES[CATEGORIES.length - 1],
    handwritten_notes: row.notes ?? '',
  };
}

/**
 * Runs only when this user has never been restored on this device *and* the
 * local database is empty. The second condition matters: a device with its own
 * receipts is the authority on them, and pulling underneath it could overwrite
 * work still queued to go up.
 */
export async function restoreIfNeeded(userId: string, categories: Category[]): Promise<number> {
  // A different account on this device owns nothing here. Local rows carry no
  // user id, so the only safe reading of "someone else's receipts are already
  // in the table" is to drop them and start this account clean.
  const owner = await store.getLocalOwner();
  if (owner && owner !== userId) await clearLocalReceiptsForAccountSwitch();
  if (owner !== userId) await store.setLocalOwner(userId);

  const state = await store.getSyncState(userId);
  if (state?.hydratedAt) return 0;

  if ((await store.countReceipts()) > 0) {
    // Nothing to restore onto, but record it so this does not re-check forever.
    await store.setHydrated(userId, null);
    return 0;
  }

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  let restored = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('receipts')
      .select('id,capture_id,merchant,txn_date,currency,total,category_id,notes,image_path,status,created_at,receipt_items(name,amount)')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .in('status', ['confirmed', 'needs_review'])
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data ?? []) as unknown as ServerReceipt[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.capture_id || !row.id) continue;
      await store.upsertRestored({
        captureId: row.capture_id,
        receiptId: row.id,
        status: toLocalStatus(row.status),
        fields: toFields(row, categoryNameById),
        remoteImagePath: row.image_path,
        createdAt: Date.parse(row.created_at) || Date.now(),
      });
      restored += 1;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  // Written only after a clean pass, so a partial restore is retried next launch.
  await store.setHydrated(userId, null);
  return restored;
}
