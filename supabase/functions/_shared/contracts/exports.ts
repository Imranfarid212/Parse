/**
 * Export constants and file naming.
 *
 * Deliberately zod-free: the edge functions import this module directly through
 * the contracts mirror, and they run under Deno with no bare-specifier
 * resolution for `zod`. Anything the server needs at runtime lives here; the
 * schemas that validate the wire format stay in schemas.ts, which only the app
 * imports.
 */
/**
 * Spelled out rather than imported from ./enums so this module has no imports
 * at all: the edge functions load it directly under Deno, where a bare
 * extensionless specifier does not resolve. enums.ts keeps the canonical list
 * and the contract test pins the two together.
 */
type ArtifactKind = 'workbook' | 'statement' | 'images';

/** Blueprint §12: download links stop working seven days after they are minted. */
export const EXPORT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Images beyond this count per file are split into further parts (T7.5). */
export const EXPORT_IMAGES_PER_PART = 50;

export const EXPORT_FILE_PREFIX = 'parse_export';

/** Where an export's files live: exports/{uid}/{job_id}/ (Blueprint §3). */
export function exportStoragePath(userId: string, jobId: string, fileName: string): string {
  return `${userId}/${jobId}/${fileName}`;
}

/**
 * The user-visible file names: parse_export_YYYY-MM-DD.xlsx, .pdf, and
 * _images.pdf. A chunked images PDF appends _partNofM; the unchunked name keeps
 * the plain form, because that is the name most users will ever see.
 *
 * The playbook writes these as receiptflow_export_*. The product is called
 * Parse, and a file landing in someone's Downloads folder is branding — so the
 * name follows the app, not the document. Recorded in DL-006.
 */
export function exportFileName(input: {
  kind: ArtifactKind;
  date: string;
  part?: number;
  part_count?: number;
}): string {
  const part = input.part ?? 1;
  const partCount = input.part_count ?? 1;
  const suffix = partCount > 1 ? `_part${part}of${partCount}` : '';
  if (input.kind === 'workbook') return `${EXPORT_FILE_PREFIX}_${input.date}${suffix}.xlsx`;
  if (input.kind === 'statement') return `${EXPORT_FILE_PREFIX}_${input.date}${suffix}.pdf`;
  return `${EXPORT_FILE_PREFIX}_${input.date}_images${suffix}.pdf`;
}
