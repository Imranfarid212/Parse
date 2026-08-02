/**
 * "Does this photo look like a receipt at all?", decided on device from the
 * text OCR already read, before anything is sent to a model.
 *
 * Deliberately dependency-free — no React Native, no Expo, no imports at all —
 * so it is a pure function over a string and can be exercised directly by
 * scripts/verify-b4-preflight.js. It used to live inside capture.ts, where the
 * only way to test it was to point a phone at a wall.
 *
 * It warns rather than blocks. The signal is nothing more than money-shaped
 * numbers and receipt vocabulary, so it is wrong often enough that an unusual
 * receipt — a handwritten bill, a language it has no keywords for — must still
 * be able to go through.
 */

export type PreflightDecision = 'continue' | 'cancel';

export type PreflightWarning = {
  /** 'low' is "almost certainly not a receipt"; 'uncertain' is "too little to tell". */
  confidence: 'low' | 'uncertain';
  textLength: number;
  amountCount: number;
  keywordCount: number;
  hasDocument: boolean;
  timedOut: boolean;
};

/** Money-shaped: an optional currency marker and always two decimal places. */
const AMOUNT_PATTERN = /(?:rs\.?|inr|₹|\$|cad|usd)?\s*\d{1,7}(?:[.,]\d{2})/gi;

const KEYWORD_PATTERN =
  /\b(receipt|invoice|bill|total|subtotal|tax|gst|vat|paid|cash|card|debit|credit|amount|qty|item|change|balance)\b/gi;

/**
 * Returns null when the capture should proceed, or the warning to show.
 *
 * @param text OCR output, or null when OCR produced nothing.
 * @param hasDocument Whether document detection found page edges — a framed
 *   page with little text reads very differently from a photo of a wall.
 * @param timedOut Whether OCR hit its deadline; carried through so the prompt
 *   can say the check was cut short rather than implying a verdict.
 */
export function scoreReceiptPreflight(
  text: string | null,
  hasDocument: boolean,
  timedOut: boolean,
): PreflightWarning | null {
  const normalized = text ?? '';
  const amountCount = [...normalized.matchAll(AMOUNT_PATTERN)].length;
  const keywordCount = [...normalized.matchAll(KEYWORD_PATTERN)].length;
  const textLength = normalized.trim().length;

  // Any one of these is enough to stay out of the way.
  const likelyReceipt = amountCount >= 2 || (amountCount >= 1 && keywordCount >= 1) || keywordCount >= 3;
  if (likelyReceipt) return null;

  const warning = { textLength, amountCount, keywordCount, hasDocument, timedOut };

  // Nothing framed and almost nothing read: a wall, a table, a blurred hand.
  if (!hasDocument && textLength < 40) return { confidence: 'low', ...warning };
  // Something was read, but not one number and not one receipt word.
  if (textLength < 80 && amountCount === 0 && keywordCount === 0) return { confidence: 'low', ...warning };
  // Enough text to be a document, too little evidence to call it a receipt.
  if (textLength < 180 && amountCount === 0 && keywordCount <= 1) return { confidence: 'uncertain', ...warning };

  // No length ceiling on this one. A receipt carries at least one money-shaped
  // number or one receipt word; text with neither is not a receipt however much
  // of it there is. The rule above used to stop at 180 characters, which waved
  // through a photograph of a keyboard — 218 characters of key legends, no
  // amounts, no keywords — straight to a paid model call.
  //
  // Both counts have to be zero. The keyword list is English-only, so a receipt
  // in a script this cannot read still passes on its digits alone.
  if (amountCount === 0 && keywordCount === 0) return { confidence: 'uncertain', ...warning };

  return null;
}
