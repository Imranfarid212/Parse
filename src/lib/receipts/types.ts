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
  total: number;
  category: string;
  handwritten_notes: string;
};

/** The one specified error: the image isn't a receipt. */
export type ExtractNotAReceipt = { error: 'not_a_receipt' };

export type ExtractResponse = ExtractSuccess | ExtractError;
export type ExtractError = ExtractNotAReceipt;

export const isNotAReceipt = (r: ExtractResponse): r is ExtractNotAReceipt =>
  typeof (r as ExtractNotAReceipt).error === 'string';

/**
 * The normalized, app-side receipt. `date` is YYYY-MM-DD (or null when the
 * printed date was unparseable — the edit sheet is how the user fixes that).
 * These 6 fields are what the review card shows and the edit sheet writes.
 */
export type ReceiptFields = {
  date: string | null;
  store: string;
  items: string[];
  total: number;
  category: Category;
  handwritten_notes: string;
};

export type CaptureMode = 'default' | 'one_click';

/**
 * Every photo becomes a row the moment it is taken, so we always know which
 * scans haven't come back yet.
 *
 * pending_extract — image on device, /extract hasn't succeeded; retry on reconnect
 * extracted       — fields in hand, awaiting the user (Default mode review)
 * confirmed_local — user confirmed (or One-click auto-confirmed); not yet on the server
 * synced          — the server has it
 */
export type ReceiptStatus = 'pending_extract' | 'extracted' | 'confirmed_local' | 'synced';

export type ReceiptRow = {
  id: string;
  imageUri: string;
  captureMode: CaptureMode;
  status: ReceiptStatus;
  fields: ReceiptFields | null;
  attempts: number;
  nextRetryAt: number;
  receiptId: string | null;
  ackedAt: number | null;
  createdAt: number;
  updatedAt: number;
};
