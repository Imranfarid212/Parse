// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Font embedding for PDF exports.
 *
 * pdf-lib's built-in fonts are WinAnsi only, which means a merchant called
 * "Bäckerei Müller" is a best case and a Greek or Cyrillic one throws. This app
 * launches globally, so the statement embeds a Unicode font instead. The
 * subset covers Latin, Latin Extended, Greek, Cyrillic, punctuation and
 * currency symbols; scripts outside that (CJK, Indic, Arabic) render as the
 * font's missing-glyph box rather than failing the export — recorded as a known
 * gap in the decision log, since covering them means shipping a different font
 * family, not a bigger subset.
 */
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

import { NOTO_SANS_REGULAR_BASE64 } from './fonts/noto-sans-regular.ts';
import { NOTO_SANS_SEMIBOLD_BASE64 } from './fonts/noto-sans-semibold.ts';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function embedExportFonts(pdf) {
  pdf.registerFontkit(fontkit);
  const [regular, semibold] = await Promise.all([
    pdf.embedFont(decodeBase64(NOTO_SANS_REGULAR_BASE64), { subset: true }),
    pdf.embedFont(decodeBase64(NOTO_SANS_SEMIBOLD_BASE64), { subset: true }),
  ]);
  return { regular, semibold };
}

/**
 * Receipt text is untrusted input (D18). Control characters and newlines would
 * break the layout engine rather than the security model, but either way this
 * is the only place a merchant name reaches a drawing call.
 */
export function sanitizeText(value: unknown, max = 200): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Trims to fit a column, with an ellipsis so truncation is visible. */
export function fitText(text: string, font, size: number, maxWidth: number): string {
  const clean = sanitizeText(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let low = 0;
  let high = clean.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${clean.slice(0, mid)}…`, size) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${clean.slice(0, low)}…`;
}
