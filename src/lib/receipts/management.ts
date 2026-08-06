import type { Category as ContractCategory, SearchQuery } from '@/../packages/contracts/src';
import { searchQuerySchema } from '@/../packages/contracts/src';
import { isSupabaseConfigured, supabase } from '@/lib/auth/supabase';
import * as store from '@/lib/receipts/store';
import { CATEGORIES, isCategory, normalizeReceiptItems, type ReceiptFields } from '@/lib/receipts/types';

export type ManagedReceipt = {
  id: string;
  localId: string;
  status: 'processing' | 'needs_review' | 'confirmed' | 'failed';
  fields: ReceiptFields;
  categoryId: number | null;
  imagePath: string | null;
  createdAt: string;
  updatedAt: string;
  rank: number;
  revision: number;
};

type RpcReceipt = {
  id: string;
  capture_id: string;
  status: ManagedReceipt['status'];
  merchant: string | null;
  txn_date: string | null;
  currency: string;
  total: number | null;
  category_id: number | null;
  category_name: string | null;
  image_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  line_items: unknown;
  search_rank: number;
};

const defaultCategory = CATEGORIES[CATEGORIES.length - 1];

function fromRpc(row: RpcReceipt): ManagedReceipt {
  return {
    id: row.id,
    localId: row.capture_id,
    status: row.status,
    fields: {
      store: row.merchant?.trim() || 'Receipt',
      date: row.txn_date,
      currency: /^[A-Z]{3}$/.test(row.currency) ? row.currency : 'USD',
      total: Math.max(0, Number(row.total) || 0),
      category: isCategory(row.category_name) ? row.category_name : defaultCategory,
      handwritten_notes: row.notes ?? '',
      items: normalizeReceiptItems(row.line_items),
    },
    categoryId: row.category_id,
    imagePath: row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rank: Number(row.search_rank) || 0,
    revision: 0,
  };
}

async function searchLocal(query: SearchQuery): Promise<ManagedReceipt[]> {
  const results = await store.searchReceipts({ ...query, limit: 200 });
  return results
    .map(({ row, rank }) => ({
      id: row.receiptId as string,
      localId: row.id,
      status: row.status === 'llm_failed_final' ? 'failed' : row.status === 'provider_delayed' ? 'processing' : 'confirmed',
      fields: row.fields as ReceiptFields,
      categoryId: row.categoryId,
      imagePath: row.remoteImagePath,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      rank,
      revision: row.serverRevision,
    }) satisfies ManagedReceipt);
}

async function searchServer(query: SearchQuery): Promise<ManagedReceipt[]> {
  const parsed = searchQuerySchema.parse(query);
  const { data, error } = await supabase.rpc('search_receipts', {
    p_text: parsed.text || null,
    p_date_from: parsed.date_from ?? null,
    p_date_to: parsed.date_to ?? null,
    p_category_ids: parsed.category_ids?.length ? parsed.category_ids : null,
    p_amount_min: parsed.amount_min ?? null,
    p_amount_max: parsed.amount_max ?? null,
    p_amount_currency: parsed.amount_currency ?? null,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return ((data ?? []) as RpcReceipt[]).map(fromRpc);
}

export async function searchManagedReceipts(query: SearchQuery, userId?: string | null): Promise<ManagedReceipt[]> {
  const parsed = searchQuerySchema.parse(query);
  if (!isSupabaseConfigured) return searchLocal(parsed);
  // A hydrated, account-owned mirror is the normal path. The server fallback
  // is reserved for first install/account takeover so an incomplete cache can
  // never masquerade as "no results".
  if (userId && await store.isLocalSearchReady(userId)) return searchLocal(parsed);
  return searchServer(parsed);
}

export function resolveCategoryId(categories: ContractCategory[], categoryName: string): number {
  const category = categories.find((candidate) => candidate.name === categoryName);
  if (!category) throw new Error('Choose one of your available categories.');
  return category.id;
}

export function validateReceiptFields(fields: ReceiptFields): string | null {
  if (!fields.store.trim() || fields.store.trim().length > 160) return 'Merchant must contain 1 to 160 characters.';
  if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) return 'Date must use YYYY-MM-DD.';
  if (!/^[A-Z]{3}$/.test(fields.currency)) return 'Currency must be a three-letter code.';
  if (!Number.isFinite(fields.total) || fields.total < 0) return 'Total must be zero or greater.';
  if (fields.handwritten_notes.length > 2000) return 'Notes must not exceed 2,000 characters.';
  if (fields.items.length > 250) return 'A receipt can contain at most 250 line items.';
  if (fields.items.some((item) => !item.name.trim() || item.name.length > 160 || item.qty <= 0 || item.amount < 0)) {
    return 'Each line item needs a name, a positive quantity, and a nonnegative amount.';
  }
  return null;
}

export async function updateManagedReceipt(
  receipt: ManagedReceipt,
  fields: ReceiptFields,
  categories: ContractCategory[],
): Promise<void> {
  const validationError = validateReceiptFields(fields);
  if (validationError) throw new Error(validationError);
  const categoryId = resolveCategoryId(categories, fields.category);
  let serverRevision: number | undefined;

  if (isSupabaseConfigured) {
    const mutation = {
      p_receipt_id: receipt.id,
      p_merchant: fields.store.trim(),
      p_txn_date: fields.date,
      p_currency: fields.currency,
      p_total: fields.total,
      p_category_id: categoryId,
      p_notes: fields.handwritten_notes.trim() || null,
      p_items: fields.items,
    };
    const { data, error } = await supabase.rpc('update_receipt_with_items_v2', {
      p_operation_id: store.newCaptureId(),
      p_expected_revision: receipt.revision > 0 ? receipt.revision : null,
      ...mutation,
    });
    // During a rolling deploy, old servers may not have v2 yet. Keep the app
    // usable until the migration lands; all other v2 errors (including a real
    // revision conflict) are surfaced rather than silently downgraded.
    if (error?.code === 'PGRST202') {
      const legacy = await supabase.rpc('update_receipt_with_items', mutation);
      if (legacy.error) throw legacy.error;
    } else if (error?.code === 'PT409') {
      throw new Error('This receipt changed since you opened it. Close the editor, refresh, and try again.');
    } else if (error) throw error;
    else serverRevision = Number(data) || undefined;
  }
  await store.updateManagedFields(receipt.localId, fields, categoryId, serverRevision);
}

export async function softDeleteManagedReceipt(receipt: ManagedReceipt): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabase.rpc('soft_delete_receipt', { p_receipt_id: receipt.id });
    if (error) throw error;
  }
  await store.markManagedDeleted(receipt.localId);
}

export async function restoreManagedReceipt(receipt: ManagedReceipt): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await supabase.rpc('restore_receipt', { p_receipt_id: receipt.id });
    if (error) throw error;
  }
  await store.restoreManagedReceipt(receipt.localId);
}
