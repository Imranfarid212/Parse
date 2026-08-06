// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The one read every export artifact is built from.
 *
 * All three files come out of a single fetch, so the workbook, the statement
 * and the images PDF cannot disagree about which receipts were in the export —
 * which they could if each ran its own query while the user was still editing
 * receipts in another tab.
 */

/** The RPC caps a page at 5,000; stay well under it so one slow page can't stall a job. */
const PAGE_SIZE = 500;

/** T7.5's ceiling with headroom. Beyond this the export is chunked, not truncated. */
const MAX_ROWS = 5_000;

export type ExportFilters = {
  text?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  category_ids?: number[] | null;
  amount_min?: number | null;
  amount_max?: number | null;
  amount_currency?: string | null;
};

export async function fetchExportRows(admin, userId: string, filters: ExportFilters = {}) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await admin.rpc('export_receipt_rows', {
      p_user_id: userId,
      p_text: filters.text || null,
      p_date_from: filters.date_from ?? null,
      p_date_to: filters.date_to ?? null,
      p_category_ids: filters.category_ids?.length ? filters.category_ids : null,
      p_amount_min: filters.amount_min ?? null,
      p_amount_max: filters.amount_max ?? null,
      p_amount_currency: filters.amount_currency ?? null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) throw error;
    const page = (data ?? []).map(normalizeRow);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function normalizeRow(row) {
  return {
    id: row.id,
    txn_date: row.txn_date ?? null,
    merchant: row.merchant ?? null,
    category_name: row.category_name ?? null,
    currency: (row.currency || 'USD').toUpperCase(),
    total: Number(row.total) || 0,
    notes: row.notes ?? null,
    image_path: row.image_path ?? null,
    created_at: row.created_at,
    line_items: Array.isArray(row.line_items)
      ? row.line_items.map((item) => ({
          name: String(item?.name ?? ''),
          qty: Number(item?.qty) || 0,
          amount: Number(item?.amount) || 0,
        }))
      : [],
  };
}

/** A one-line description of what was exported, printed on the statement. */
export function describeFilters(filters: ExportFilters = {}): string {
  const parts: string[] = [];
  if (filters.date_from || filters.date_to) {
    parts.push(`Dates ${filters.date_from ?? 'any'} to ${filters.date_to ?? 'any'}`);
  }
  if (filters.text) parts.push(`Text "${filters.text}"`);
  if (filters.category_ids?.length) parts.push(`${filters.category_ids.length} categories`);
  if (filters.amount_min !== undefined && filters.amount_min !== null) {
    parts.push(`Min ${filters.amount_min} ${filters.amount_currency ?? ''}`.trim());
  }
  if (filters.amount_max !== undefined && filters.amount_max !== null) {
    parts.push(`Max ${filters.amount_max} ${filters.amount_currency ?? ''}`.trim());
  }
  return parts.length > 0 ? parts.join(' · ') : 'All receipts';
}
