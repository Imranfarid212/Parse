// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * The xlsx export: one sheet per currency, each a plain table of receipts.
 *
 * Separating currencies into their own sheets is what makes the no-cross-currency
 * rule (D13) structural rather than a convention — there is no sheet on which two
 * currencies appear, so there is nowhere a combined total could be written, and
 * the per-currency subtotal rows an earlier cut needed are simply not necessary.
 * A user who wants a total selects the amount column and reads Excel's status
 * bar, which is now a correct thing to do on every sheet.
 *
 * Amounts are real numbers with a 0.00 format and dates are real dates with a
 * dd/mm/yyyy format, so the sheet sorts, filters and sums as a spreadsheet
 * rather than as a page of text.
 *
 * Written with xlsx-js-style rather than SheetJS Community Edition because CE
 * does not write cell styling, and the header row has to be bold on an olive
 * fill. Only the writing path is used here; nothing on the server ever parses a
 * spreadsheet. The tests read these files back with the vendored SheetJS 0.20.3,
 * which makes the reader a different implementation from the writer.
 */
import XLSXS from 'https://esm.sh/xlsx-js-style@1.2.0';

import { groupByCurrency } from './money.ts';

/**
 * No Currency column: the sheet is named for its currency, so repeating it on
 * every row says nothing. The code moves into the Amount header instead, which
 * keeps it attached to the numbers it qualifies — so a row copied out of the
 * sheet still lands next to a heading that names the currency.
 */
const headersFor = (currency: string) => ['Date', 'Merchant', 'Category', `Amount (${currency})`, 'Notes'];

const AMOUNT_COLUMN = 3;

/** Light olive green, the classic Excel header fill. */
export const HEADER_FILL = 'D8E4BC';

const HEADER_STYLE = {
  font: { bold: true },
  fill: { patternType: 'solid', fgColor: { rgb: HEADER_FILL } },
  alignment: { vertical: 'center' },
};

const DATE_FORMAT = 'dd/mm/yyyy';
const AMOUNT_FORMAT = '0.00';

const COLUMN_WIDTHS = [{ wch: 12 }, { wch: 34 }, { wch: 26 }, { wch: 16 }, { wch: 40 }];

export function buildWorkbook(rows) {
  const workbook = XLSXS.utils.book_new();
  const groups = groupByCurrency(rows);

  if (groups.length === 0) {
    // An export of nothing is still a file the user can open, and a workbook
    // with no sheets is not a valid workbook.
    XLSXS.utils.book_append_sheet(workbook, currencySheet([], ''), 'Receipts');
  } else {
    for (const group of groups) {
      XLSXS.utils.book_append_sheet(workbook, currencySheet(group.rows, group.currency), group.currency);
    }
  }

  return new Uint8Array(XLSXS.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
}

function currencySheet(rows, currency: string) {
  const headers = headersFor(currency || rows[0]?.currency || '');
  const aoa = [headers];
  for (const row of rows) {
    aoa.push([
      toDate(row.txn_date),
      row.merchant ?? '',
      row.category_name ?? 'Miscellaneous',
      row.total,
      row.notes ?? '',
    ]);
  }

  const sheet = XLSXS.utils.aoa_to_sheet(aoa, { cellDates: true });

  for (let column = 0; column < headers.length; column += 1) {
    const address = XLSXS.utils.encode_cell({ r: 0, c: column });
    if (sheet[address]) sheet[address].s = HEADER_STYLE;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const dateCell = sheet[XLSXS.utils.encode_cell({ r: rowNumber, c: 0 })];
    if (dateCell && dateCell.t === 'd') dateCell.z = DATE_FORMAT;
    const amountCell = sheet[XLSXS.utils.encode_cell({ r: rowNumber, c: AMOUNT_COLUMN })];
    if (amountCell) amountCell.z = AMOUNT_FORMAT;
  }

  sheet['!cols'] = COLUMN_WIDTHS;
  // Filter dropdowns on the header row. Frozen panes are deliberately not set:
  // the writer ignores them silently, and configuration that does nothing is
  // worse than none.
  sheet['!autofilter'] = { ref: `A1:E${Math.max(rows.length + 1, 1)}` };
  return sheet;
}

/**
 * A real date cell where possible; the raw value when the date is unusable.
 *
 * Built from local components rather than parsed as UTC. The writer turns a Date
 * into an Excel serial relative to local midnight, so `2026-07-02T00:00:00Z`
 * becomes 05:30 on a host at UTC+5:30 and 19:00 the previous day on one at
 * UTC-5. The displayed day survives that (the writer corrects for the offset),
 * but the cell carries a spurious time and the correction leans on the host's
 * timezone table. Constructing local midnight keeps the serial on the day
 * itself, whatever machine builds the file.
 */
function toDate(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * The sheets a verifier should expect, exposed so the gate can compare the file
 * against SQL without re-deriving the grouping rules.
 */
export function workbookSheets(rows) {
  const groups = groupByCurrency(rows);
  if (groups.length === 0) return [{ name: 'Receipts', receipts: 0 }];
  return groups.map((group) => ({ name: group.currency, receipts: group.rows.length }));
}
