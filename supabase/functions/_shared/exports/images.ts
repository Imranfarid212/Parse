// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The images PDF: exactly the filtered images, one per page, date-ordered
 * (Blueprint §12, gate T7.3).
 *
 * Two constraints shape this file. First, memory: an edge function that holds
 * a thousand JPEGs and a thousand embedded images at once dies, so images are
 * fetched one at a time and each part is serialized and handed back before the
 * next part starts — the caller uploads it and drops the bytes. Second,
 * honesty about gaps: a receipt whose image never finished uploading (the
 * client-custody case in DL-002) has nothing to print, so it is reported as
 * skipped rather than silently making the PDF shorter than the export it
 * claims to represent.
 */
import { PDFDocument, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

import { EXPORT_IMAGES_PER_PART } from '../contracts/exports.ts';
import { formatDay } from './dates.ts';
import { embedExportFonts, fitText, sanitizeText } from './fonts.ts';
import { formatAmount } from './money.ts';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const CAPTION_HEIGHT = 54;

/**
 * How many images to fetch at once.
 *
 * Downloads dominate this job and they are almost all latency. Fetching one at a
 * time cost a staging run of 120 images enough wall clock that the edge function
 * was killed mid-build and the sweeper had to finish it on a second attempt —
 * correct behaviour, but a slow path taken for no reason. Eight in flight keeps
 * at most a few megabytes buffered while removing most of the waiting.
 */
const FETCH_CONCURRENCY = 8;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.44, 0.48);

/**
 * @param rows          export rows, already date-ordered by SQL
 * @param fetchImage    (path) => Uint8Array | null — null means "not available"
 * @param onPart        called with each finished part so the caller can upload
 *                      and release it before the next one is built
 */
export async function buildImagePdfs(rows, fetchImage, onPart, options = {}) {
  const perPart = Math.max(1, Number(options.perPart) || EXPORT_IMAGES_PER_PART);
  const withImages = rows.filter((row) => typeof row.image_path === 'string' && row.image_path.length > 0);
  const skipped = rows.filter((row) => !row.image_path).map((row) => row.id);
  const unavailable: string[] = [];

  if (withImages.length === 0) {
    return { parts: 0, embedded: 0, skipped, unavailable };
  }

  const partCount = Math.ceil(withImages.length / perPart);
  let embedded = 0;

  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const slice = withImages.slice(partIndex * perPart, (partIndex + 1) * perPart);
    const pdf = await PDFDocument.create();
    pdf.setTitle('Parse receipt images');
    pdf.setCreator('Parse');
    const fonts = await embedExportFonts(pdf);
    let pagesInPart = 0;

    // Fetch a window ahead, embed strictly in order. Pages must follow the SQL
    // date order (T7.3), so concurrency belongs to the downloads only.
    for (let start = 0; start < slice.length; start += FETCH_CONCURRENCY) {
      const batch = slice.slice(start, start + FETCH_CONCURRENCY);
      const pending = batch.map((row) =>
        Promise.resolve()
          .then(() => fetchImage(row.image_path))
          .catch(() => null),
      );

      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index];
        const bytes = await pending[index];
        if (!bytes || bytes.length === 0) {
          unavailable.push(row.id);
          continue;
        }

        try {
          await drawImagePage(pdf, fonts, row, bytes);
          pagesInPart += 1;
          embedded += 1;
        } catch {
          // A corrupt or unsupported object must not take the whole export down;
          // it is reported the same way a missing one is.
          unavailable.push(row.id);
        }
      }
    }

    if (pagesInPart === 0) continue;
    const saved = await pdf.save();
    await onPart({ bytes: saved, part: partIndex + 1, partCount, receiptCount: pagesInPart });
  }

  return { parts: partCount, embedded, skipped, unavailable };
}

async function drawImagePage(pdf, fonts, row, bytes) {
  const image = await embedByFormat(pdf, bytes);
  const page = pdf.addPage([PAGE.width, PAGE.height]);

  const maxWidth = PAGE.width - MARGIN * 2;
  const maxHeight = PAGE.height - MARGIN * 2 - CAPTION_HEIGHT;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;

  page.drawImage(image, {
    x: MARGIN + (maxWidth - width) / 2,
    y: PAGE.height - MARGIN - height,
    width,
    height,
  });

  const captionY = PAGE.height - MARGIN - height - 20;
  const merchant = fitText(row.merchant ?? 'Receipt', fonts.semibold, 12, maxWidth);
  page.drawText(merchant, { x: MARGIN, y: captionY, size: 12, font: fonts.semibold, color: INK });

  const meta = sanitizeText(
    `${formatDay(row.txn_date)} · ${row.category_name ?? 'Miscellaneous'} · ${formatAmount(row.total)} ${row.currency}`,
    160,
  );
  page.drawText(fitText(meta, fonts.regular, 9.5, maxWidth), {
    x: MARGIN,
    y: captionY - 15,
    size: 9.5,
    font: fonts.regular,
    color: MUTED,
  });
}

/**
 * Captures are JPEG by contract, but the bucket is old enough to hold whatever
 * earlier phases put there, so the magic bytes decide rather than the extension.
 */
async function embedByFormat(pdf, bytes) {
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
}
