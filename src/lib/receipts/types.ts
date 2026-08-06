/**
 * The POST /extract contract (HANDOFF §5) and the app-side shape it becomes.
 *
 * Keep this file in sync with HANDOFF.md §5 — it is what the backend team
 * builds against.
 */

/** The 10 categories. The backend returns one of these strings verbatim. */
export const CATEGORIES = [
  'Travel & Transit',
  'Meals & Entertainment',
  'Office Supplies',
  'Software & IT',
  'Vehicle Expenses',
  'Advertising & Marketing',
  'Professional Services',
  'Utilities & Telecom',
  'Inventory & Materials',
  'Miscellaneous',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);

/** Success payload, exactly as the wire returns it. `date` is AS PRINTED. */
export type ExtractSuccess = {
  date: string;
  store: string;
  items: ReceiptLineItem[];
  currency?: string;
  total: number;
  category: string;
  handwritten_notes: string;
};

/** The one specified error: the image isn't a receipt. */
export type ExtractNotAReceipt = { error: 'not_a_receipt' };
export type ExtractDuplicateReceipt = { error: 'duplicate_receipt' };
export type DuplicateCandidate = {
  matchedReceiptId: string;
  matchRule: string;
  matchStrength: 'weak' | 'strong';
  merchant?: string | null;
  date?: string | null;
  currency?: string | null;
  total?: number | null;
};

export type LocalDuplicateCandidate = DuplicateCandidate & {
  matchedLocalRowId: string;
  matchedImageUri: string;
  fields: ReceiptFields;
};

export type ExtractResponse = ExtractSuccess | ExtractError;
export type ExtractError = ExtractNotAReceipt | ExtractDuplicateReceipt;

export const isNotAReceipt = (r: ExtractResponse): r is ExtractNotAReceipt =>
  (r as ExtractError).error === 'not_a_receipt';

export const isDuplicateReceipt = (r: ExtractResponse): r is ExtractDuplicateReceipt =>
  (r as ExtractError).error === 'duplicate_receipt';

/**
 * The normalized, app-side receipt. `date` is YYYY-MM-DD (or null when the
 * printed date was unparseable — the edit sheet is how the user fixes that).
 * These 6 fields are what the review card shows and the edit sheet writes.
 */
export type ReceiptLineItem = { name: string; qty: number; amount: number };

/** Converts pre-8.4 string rows on disk into editable structured rows. */
export function normalizeReceiptItems(value: unknown): ReceiptLineItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item && typeof item === 'object') {
      const row = item as Partial<ReceiptLineItem>;
      return { name: String(row.name ?? 'Item').trim().slice(0, 160) || 'Item', qty: Number(row.qty) > 0 ? Number(row.qty) : 1, amount: Math.max(0, Number(row.amount) || 0) };
    }
    const text = String(item ?? '').trim();
    const match = /^(.*?)[\s]+(?:[A-Z]{3}\s*)?[$₹€£¥]?(\d[\d,]*\.\d{2})$/.exec(text);
    return { name: (match?.[1] ?? text).trim().slice(0, 160) || 'Item', qty: 1, amount: Number(match?.[2]?.replace(/,/g, '')) || 0 };
  });
}

export type ReceiptFields = {
  date: string | null;
  store: string;
  items: ReceiptLineItem[];
  currency: string;
  total: number;
  category: Category;
  handwritten_notes: string;
};

export type CaptureMode = 'default' | 'one_click';
export type ExtractionMode = 'balanced' | 'precise';

/**
 * Every photo becomes a row the moment it is taken, so we always know which
 * scans haven't come back yet.
 *
 * pending_extract — image on device, /extract hasn't succeeded; retry on reconnect
 * extracted       — fields in hand, awaiting the user (Default mode review)
 * confirmed_local — user confirmed (or One-click auto-confirmed); not yet on the server
 * synced          — the server has it
 */
export type ReceiptStatus =
  | 'local_captured'
  | 'local_ocr_processing'
  | 'local_ocr_done'
  | 'image_upload_pending'
  | 'image_uploaded'
  | 'pending_extract'
  | 'llm_processing'
  | 'llm_failed_retryable'
  | 'provider_delayed'
  | 'llm_failed_final'
  /**
   * Refused for quota. Terminal for the retry queue — retrying cannot conjure
   * scans — but recoverable by the user, unlike llm_failed_final: the capture
   * and its photo are kept so upgrading makes it scannable again. Previously
   * this deleted both, which after offline capture became possible with nobody
   * watching.
   */
  | 'blocked_quota'
  | 'user_confirmation_pending'
  | 'extracted'
  | 'confirmed_local'
  | 'result_sync_pending'
  | 'synced'
  | 'delete_pending'
  | 'deleted';

export type ReceiptRow = {
  id: string;
  imageUri: string;
  captureMode: CaptureMode;
  extractionMode: ExtractionMode;
  status: ReceiptStatus;
  fields: ReceiptFields | null;
  localOcrText: string | null;
  dedupeKey: string | null;
  ocrFingerprint: string | null;
  duplicateOf: string | null;
  duplicateMatchStrength: 'weak' | 'strong' | null;
  imageSyncStatus:
    | 'local_only'
    | 'pending_upload'
    | 'uploading'
    | 'uploaded'
    | 'upload_failed'
    | 'upload_failed_final'
    | 'missing_local_file';
  resultSyncStatus: 'local_only' | 'pending_sync' | 'syncing' | 'synced' | 'sync_failed' | 'sync_failed_final';
  attempts: number;
  nextRetryAt: number;
  receiptId: string | null;
  /** Server category/revision metadata retained locally for exact filtering
   * and future optimistic concurrency. */
  categoryId: number | null;
  serverRevision: number;
  serverUpdatedAt: string | null;
  /** Storage path of the image on the server; the only route back to the
   *  photo for a receipt restored onto a device that never took it. */
  remoteImagePath: string | null;
  ackedAt: number | null;
  createdAt: number;
  updatedAt: number;
};
