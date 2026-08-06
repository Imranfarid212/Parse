// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The PDF statement: one section per currency, per-category totals inside each
 * section (Blueprint §12, gate T7.2).
 *
 * There is no grand total in this document and there is no code path that could
 * produce one — every number printed comes from `subtotalFor` or
 * `categoryTotalsFor`, both of which take a single-currency group. The document
 * also says so in print, because a user looking for a total they cannot find
 * deserves an explanation rather than the suspicion that the export is broken.
 */
import { PDFDocument, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

import { formatDay, formatTimestamp } from './dates.ts';
import { embedExportFonts, fitText, sanitizeText } from './fonts.ts';
import { categoryTotalsFor, formatAmount, groupByCurrency, subtotalFor } from './money.ts';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const BOTTOM_LIMIT = MARGIN + 28;

const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.85, 0.86, 0.88);

/**
 * The same light olive green the workbook fills its header row with (D8E4BC),
 * so a statement and a sheet from one export look like one export.
 */
const HEADER_BG = rgb(0xd8 / 255, 0xe4 / 255, 0xbc / 255);
const HEADER_INK = rgb(0.22, 0.26, 0.16);

export const NO_GRAND_TOTAL_NOTE =
  'Totals are shown per currency. Parse does not convert between currencies, so there is no combined total.';

export async function buildStatement(rows, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const filterSummary = sanitizeText(options.filterSummary ?? 'All receipts', 160);
  const timeZone = options.timeZone ?? null;

  const pdf = await PDFDocument.create();
  pdf.setTitle('Parse export');
  pdf.setCreator('Parse');
  const fonts = await embedExportFonts(pdf);

  const layout = createLayout(pdf, fonts);
  drawDocumentHeader(layout, { generatedAt, filterSummary, timeZone, receiptCount: rows.length });

  const groups = groupByCurrency(rows);
  if (groups.length === 0) {
    layout.paragraph('No receipts matched these filters.', { size: 11, color: MUTED });
  }

  for (const group of groups) {
    drawCurrencySection(layout, group);
  }

  drawPageNumbers(pdf, fonts);
  return await pdf.save();
}

/** A tiny cursor-based writer: it owns the page break so no caller can forget one. */
function createLayout(pdf, fonts) {
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const layout = {
    get page() {
      return page;
    },
    get y() {
      return y;
    },
    fonts,
    newPage() {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
    },
    /** Reserves vertical space, starting a page when the block would not fit. */
    require(height: number) {
      if (y - height < BOTTOM_LIMIT) layout.newPage();
    },
    advance(height: number) {
      y -= height;
    },
    text(value: string, x: number, options = {}) {
      page.drawText(value, {
        x,
        y: y - (options.baseline ?? 0),
        size: options.size ?? 9,
        font: options.bold ? fonts.semibold : fonts.regular,
        color: options.color ?? INK,
      });
    },
    right(value: string, rightEdge: number, options = {}) {
      const font = options.bold ? fonts.semibold : fonts.regular;
      const size = options.size ?? 9;
      const width = font.widthOfTextAtSize(value, size);
      layout.text(value, rightEdge - width, options);
    },
    rule(color = RULE) {
      page.drawRectangle({ x: MARGIN, y: y - 1, width: CONTENT_WIDTH, height: 0.6, color });
    },
    /**
     * A header band drawn around the text baseline at the current cursor.
     *
     * The earlier version took a fixed height and offset the rectangle down by
     * three points, which put the band's top below the cap height of the text
     * sitting on it — the header appeared to float above its own background.
     * The band is now derived from the font's ascent at the size being drawn, so
     * it encloses the text whatever size a caller picks.
     */
    band(size = 8.5, padTop = 4.5, padBottom = 5) {
      const ascent = fonts.semibold.heightAtSize(size, { descender: false });
      page.drawRectangle({
        x: MARGIN,
        y: y - padBottom,
        width: CONTENT_WIDTH,
        height: ascent + padTop + padBottom,
        color: HEADER_BG,
      });
    },
    paragraph(value: string, options = {}) {
      const size = options.size ?? 9;
      layout.require(size + 6);
      layout.text(fitText(value, options.bold ? fonts.semibold : fonts.regular, size, CONTENT_WIDTH), MARGIN, options);
      layout.advance(size + 6);
    },
  };
  return layout;
}

function drawDocumentHeader(layout, { generatedAt, filterSummary, timeZone, receiptCount }) {
  layout.text(`Generated ${formatTimestamp(generatedAt, timeZone)}`, MARGIN, { size: 9, color: MUTED });
  layout.advance(13);
  layout.text(`Filters: ${filterSummary}`, MARGIN, { size: 9, color: MUTED });
  layout.advance(13);
  layout.text(`${receiptCount} receipt${receiptCount === 1 ? '' : 's'}`, MARGIN, { size: 9, color: MUTED });
  layout.advance(18);
  layout.text(fitText(NO_GRAND_TOTAL_NOTE, layout.fonts.regular, 8.5, CONTENT_WIDTH), MARGIN, {
    size: 8.5,
    color: MUTED,
  });
  layout.advance(16);
  layout.rule();
  layout.advance(20);
}

function drawCurrencySection(layout, group) {
  const subtotal = subtotalFor(group);
  const categories = categoryTotalsFor(group);

  // The heading, the category table's own header and at least one category row
  // must land together: a currency heading alone at the foot of a page reads as
  // a section with no money in it.
  layout.require(96);
  layout.text(group.currency, MARGIN, { size: 14, bold: true });
  layout.right(`${formatAmount(subtotal)} ${group.currency}`, PAGE.width - MARGIN, { size: 14, bold: true });
  layout.advance(16);
  layout.text(`${group.rows.length} receipt${group.rows.length === 1 ? '' : 's'} · subtotal for this currency only`, MARGIN, {
    size: 8.5,
    color: MUTED,
  });
  layout.advance(16);

  drawCategoryTable(layout, categories, group.currency);
  drawReceiptTable(layout, group);
  layout.advance(10);
}

const CATEGORY_COLUMNS = { category: MARGIN, receipts: MARGIN + 300, total: PAGE.width - MARGIN };

function drawCategoryTable(layout, categories, currency) {
  layout.require(34);
  layout.band(8.5);
  layout.text('Category', CATEGORY_COLUMNS.category + 6, { size: 8.5, bold: true, color: HEADER_INK });
  layout.text('Receipts', CATEGORY_COLUMNS.receipts, { size: 8.5, bold: true, color: HEADER_INK });
  layout.right(`Total (${currency})`, CATEGORY_COLUMNS.total - 6, { size: 8.5, bold: true, color: HEADER_INK });
  layout.advance(18);

  for (const entry of categories) {
    layout.require(15);
    layout.text(fitText(entry.category, layout.fonts.regular, 9.5, 280), CATEGORY_COLUMNS.category + 6, { size: 9.5 });
    layout.text(String(entry.receipts), CATEGORY_COLUMNS.receipts, { size: 9.5 });
    layout.right(formatAmount(entry.total), CATEGORY_COLUMNS.total - 6, { size: 9.5 });
    layout.advance(15);
  }
  layout.advance(10);
}

const RECEIPT_COLUMNS = {
  date: MARGIN,
  merchant: MARGIN + 66,
  category: MARGIN + 268,
  amount: PAGE.width - MARGIN,
};

function drawReceiptTable(layout, group) {
  layout.require(34);
  layout.band(8.5);
  layout.text('Date', RECEIPT_COLUMNS.date + 6, { size: 8.5, bold: true, color: HEADER_INK });
  layout.text('Merchant', RECEIPT_COLUMNS.merchant, { size: 8.5, bold: true, color: HEADER_INK });
  layout.text('Category', RECEIPT_COLUMNS.category, { size: 8.5, bold: true, color: HEADER_INK });
  layout.right(`Amount (${group.currency})`, RECEIPT_COLUMNS.amount - 6, { size: 8.5, bold: true, color: HEADER_INK });
  layout.advance(18);

  for (const row of group.rows) {
    layout.require(14);
    layout.text(formatDay(row.txn_date), RECEIPT_COLUMNS.date + 6, { size: 9.5 });
    layout.text(fitText(row.merchant ?? 'Receipt', layout.fonts.regular, 9.5, 190), RECEIPT_COLUMNS.merchant, { size: 9.5 });
    layout.text(fitText(row.category_name ?? 'Miscellaneous', layout.fonts.regular, 9.5, 150), RECEIPT_COLUMNS.category, {
      size: 9.5,
    });
    layout.right(formatAmount(row.total), RECEIPT_COLUMNS.amount - 6, { size: 9.5 });
    layout.advance(14);
  }
}

function drawPageNumbers(pdf, fonts) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    const width = fonts.regular.widthOfTextAtSize(label, 8);
    page.drawText(label, {
      x: PAGE.width - MARGIN - width,
      y: MARGIN - 12,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
  });
}

/** What the statement claims, in a form a verifier can compare against SQL. */
export function statementTotals(rows) {
  return groupByCurrency(rows).map((group) => ({
    currency: group.currency,
    receipts: group.rows.length,
    subtotal: formatAmount(subtotalFor(group)),
    categories: categoryTotalsFor(group).map((entry) => ({
      category: entry.category,
      receipts: entry.receipts,
      total: formatAmount(entry.total),
    })),
  }));
}
