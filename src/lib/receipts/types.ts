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
  items: string[];
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
export type ReceiptFields = {
  date: string | null;
  store: string;
  items: string[];
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
  | 'llm_failed_final'
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
  ackedAt: number | null;
  createdAt: number;
  updatedAt: number;
};
