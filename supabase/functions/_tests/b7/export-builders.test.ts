// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * B7 export builders, run for real under Deno.
 *
 * These assert against the bytes the builders produce — the workbook is parsed
 * back with SheetJS and the PDFs are read back with a PDF text extractor —
 * rather than against the functions' own return values. A subtotal that is only
 * checked against the number the same code computed proves nothing; T7.1 and
 * T7.2 are about what is in the file.
 *
 * Run: npm run b7:builders
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import * as XLSX from '../../_shared/exports/vendor/xlsx.mjs';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';

import { unzipSync } from 'https://esm.sh/fflate@0.8.2';

import { exportFileName } from '../../_shared/contracts/exports.ts';
import { formatDay, formatTimestamp, usableZone } from '../../_shared/exports/dates.ts';
import { categoryTotalsFor, groupByCurrency, subtotalFor } from '../../_shared/exports/money.ts';
import { buildImagePdfs } from '../../_shared/exports/images.ts';
import { buildStatement, NO_GRAND_TOTAL_NOTE, statementTotals } from '../../_shared/exports/statement.ts';
import { buildWorkbook, HEADER_FILL, workbookSheets } from '../../_shared/exports/workbook.ts';
import { tinyJpeg } from './tiny-jpeg.ts';

/**
 * The same four cases as the contracts fixture: three currencies, a repeated
 * category, a receipt with no image, and a merchant outside Latin-1. Restated
 * here as plain data so a test failure points at a number you can check by eye.
 */
const ROWS = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    txn_date: '2026-07-02',
    merchant: 'Whole Foods Market',
    category_name: 'Meals & Entertainment',
    currency: 'USD',
    total: 73.36,
    notes: 'Team lunch',
    image_path: 'user/one.jpg',
    created_at: '2026-07-02T10:00:00.000Z',
    line_items: [
      { name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 },
      { name: 'Cold brew coffee', qty: 2, amount: 71.62 },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    txn_date: '2026-07-05',
    merchant: 'Bäckerei Müller',
    category_name: 'Meals & Entertainment',
    currency: 'EUR',
    total: 18.4,
    notes: null,
    image_path: 'user/two.jpg',
    created_at: '2026-07-05T08:30:00.000Z',
    line_items: [{ name: 'Brötchen', qty: 6, amount: 18.4 }],
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    txn_date: '2026-07-11',
    merchant: 'City Hardware',
    category_name: 'Miscellaneous',
    currency: 'USD',
    total: 28.42,
    notes: null,
    image_path: null,
    created_at: '2026-07-11T16:45:00.000Z',
    line_items: [{ name: 'Shelf brackets', qty: 2, amount: 28.42 }],
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    txn_date: '2026-07-19',
    merchant: 'Paddington Cabs',
    category_name: 'Travel & Transit',
    currency: 'GBP',
    total: 41.05,
    notes: 'Airport run',
    image_path: 'user/four.jpg',
    created_at: '2026-07-19T21:05:00.000Z',
    line_items: [],
  },
];

const USD_SUBTOTAL = '101.78'; // 73.36 + 28.42, by hand
const EUR_SUBTOTAL = '18.40';
const GBP_SUBTOTAL = '41.05';

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const doc = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  return { text, pages: totalPages };
}

Deno.test('money refuses to add across currencies', () => {
  const groups = groupByCurrency(ROWS);
  assertEquals(groups.map((group) => group.currency), ['EUR', 'GBP', 'USD']);

  let threw = false;
  try {
    subtotalFor({ currency: 'USD', rows: [{ currency: 'EUR', total: 5 }] });
  } catch {
    threw = true;
  }
  assert(threw, 'subtotalFor must reject a row from another currency');
});

Deno.test('workbook puts each currency on its own sheet', () => {
  const book = XLSX.read(buildWorkbook(ROWS), { type: 'array', cellStyles: true });

  // Separate sheets are what makes a cross-currency total structurally
  // impossible: no sheet holds two currencies, so none can add them.
  assertEquals(book.SheetNames, ['EUR', 'GBP', 'USD']);
  assertEquals(workbookSheets(ROWS), [
    { name: 'EUR', receipts: 1 },
    { name: 'GBP', receipts: 1 },
    { name: 'USD', receipts: 2 },
  ]);

  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true });
    // The sheet is named for its currency, so the currency lives in the Amount
    // header rather than in a column repeating it on every row.
    assertEquals(rows[0], ['Date', 'Merchant', 'Category', `Amount (${name})`, 'Notes']);
    for (const row of rows) {
      const line = row.map((cell) => String(cell ?? '')).join('|');
      assert(!/Subtotal/i.test(line), `${name} still carries a subtotal row: ${line}`);
    }
  }

  const usd = XLSX.utils.sheet_to_json(book.Sheets.USD, { header: 1, raw: true });
  assertEquals(usd.length - 1, 2, 'the USD sheet holds both USD receipts');
  assertEquals(typeof usd[1][3], 'number', 'amounts stay numeric so the sheet can sum them');

  // Each sheet's amounts must be exactly its own currency's receipts. Without a
  // currency column, that is asserted by totalling the sheet against SQL.
  const totals = new Map([['EUR', '18.40'], ['GBP', '41.05'], ['USD', '101.78']]);
  for (const [currency, expected] of totals) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[currency], { header: 1, raw: true }).slice(1);
    const sum = rows.reduce((minor, row) => minor + Math.round(Number(row[3]) * 100), 0);
    assertEquals((sum / 100).toFixed(2), expected, `${currency} sheet total`);
  }
});

Deno.test('workbook exports no receipt ids and no line items', () => {
  const book = XLSX.read(buildWorkbook(ROWS), { type: 'array' });
  assert(!book.SheetNames.includes('Line items'), 'the line-items sheet must not be produced');

  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true });
    assert(!rows[0].includes('Receipt ID'), `${name} still has a Receipt ID column`);
    assert(!rows[0].includes('Currency'), `${name} still has a redundant Currency column`);
    const flat = rows.map((row) => row.map((cell) => String(cell ?? '')).join('|')).join('\n');
    for (const row of ROWS) {
      assert(!flat.includes(row.id), `${name} leaks the receipt id ${row.id}`);
    }
    // Line-item descriptions belong to no sheet now.
    assert(!flat.includes('Organic bananas'), `${name} still carries line-item text`);
  }
});

Deno.test('workbook header row is bold on the olive fill', () => {
  const bytes = buildWorkbook(ROWS);
  const book = XLSX.read(bytes, { type: 'array', cellStyles: true });

  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    for (const address of ['A1', 'B1', 'C1', 'D1', 'E1']) {
      assertEquals(sheet[address].s?.fgColor?.rgb, HEADER_FILL, `${name}!${address} is missing the header fill`);
    }
  }

  // The reader above surfaces fills but not font weight, so bold is asserted
  // against the workbook's own style table.
  const files = unzipSync(bytes);
  const styles = new TextDecoder().decode(files['xl/styles.xml']);
  assert(styles.includes('<b/>'), 'no bold font is defined in the workbook styles');
  assert(styles.toUpperCase().includes(HEADER_FILL), 'the olive fill is missing from the workbook styles');
});

Deno.test('workbook writes real dates and real numbers', () => {
  const book = XLSX.read(buildWorkbook(ROWS), { type: 'array', cellNF: true });
  const usd = book.Sheets.USD;

  assertEquals(usd.A2.t, 'n', 'a date must be a date cell, not text');
  assertEquals(usd.A2.w, '02/07/2026', 'dates display as dd/mm/yyyy');
  assertEquals(usd.A2.z, 'dd/mm/yyyy');
  // No meaningful time-of-day on the serial. The tolerance is there because the
  // writer's timezone correction uses the host's historical offset for 1899,
  // which is minutes out in some zones; what matters is that the cell sits on
  // the day rather than hours into it.
  assert(
    Math.abs(usd.A2.v - Math.round(usd.A2.v)) < 0.01,
    `date serial ${usd.A2.v} carries a time component`,
  );

  assertEquals(usd.D2.t, 'n');
  assertEquals(usd.D2.z, '0.00');
  assertEquals(usd.D2.v, 73.36);

  // A receipt with no date leaves the cell empty rather than inventing one.
  const undated = XLSX.read(buildWorkbook([{ ...ROWS[0], txn_date: null }]), { type: 'array' });
  const cell = undated.Sheets.USD.A2;
  assert(!cell || cell.v === '', `a missing date became ${JSON.stringify(cell)}`);
});

Deno.test('an export with no receipts is still a valid workbook', () => {
  const book = XLSX.read(buildWorkbook([]), { type: 'array' });
  assertEquals(book.SheetNames, ['Receipts']);
  const rows = XLSX.utils.sheet_to_json(book.Sheets.Receipts, { header: 1, raw: true });
  assertEquals(rows[0], ['Date', 'Merchant', 'Category', 'Amount ()', 'Notes']);
});

Deno.test('statement prints a section per currency with per-category totals inside', async () => {
  const bytes = await buildStatement(ROWS, {
    generatedAt: '2026-08-05T00:00:00.000Z',
    filterSummary: 'Dates 2026-07-01 to 2026-07-31',
    timeZone: 'Asia/Kolkata',
  });
  const { text, pages } = await pdfText(bytes);
  assert(pages >= 1);

  // Currency sections and their subtotals.
  assertStringIncludes(text, `${USD_SUBTOTAL} USD`);
  assertStringIncludes(text, `${EUR_SUBTOTAL} EUR`);
  assertStringIncludes(text, `${GBP_SUBTOTAL} GBP`);

  // Per-category totals inside a section: USD holds two categories that must
  // each be broken out, and they must sum to the USD subtotal and nothing else.
  const usd = groupByCurrency(ROWS).find((group) => group.currency === 'USD');
  const usdCategories = categoryTotalsFor(usd);
  assertEquals(usdCategories.length, 2);
  for (const entry of usdCategories) {
    assertStringIncludes(text, entry.category);
    assertStringIncludes(text, entry.total.toFixed(2));
  }
  assertEquals(usdCategories.reduce((sum, entry) => sum + entry.total, 0).toFixed(2), USD_SUBTOTAL);

  // A non-Latin-1 merchant survives the embedded font rather than throwing.
  assertStringIncludes(text, 'Bäckerei Müller');

  // And the document says out loud that there is no combined total.
  assertStringIncludes(text, NO_GRAND_TOTAL_NOTE.slice(0, 48));
  assert(!/grand total/i.test(text), 'statement must not print a grand total');

  // No cover title, and the product is called Parse.
  assert(!/ReceiptFlow/i.test(text), 'the statement must not mention ReceiptFlow');
  assert(!/^\s*Parse export/.test(text), 'the statement must not print a document title');
  assertStringIncludes(text, 'Parse does not convert between currencies');

  // Dates read the way a person writes them.
  assertStringIncludes(text, '02/07/2026');
  assert(!text.includes('2026-07-02'), 'ISO dates should not appear in the statement');
  assertStringIncludes(text, 'Generated 05/08/2026 05:30 AM GMT+5:30');

  const claimed = statementTotals(ROWS);
  assertEquals(claimed.map((section) => section.currency), ['EUR', 'GBP', 'USD']);
});

Deno.test('images PDF holds exactly the filtered images, date-ordered', async () => {
  const parts = [];
  const result = await buildImagePdfs(
    ROWS,
    () => Promise.resolve(tinyJpeg()),
    (part) => {
      parts.push(part);
      return Promise.resolve();
    },
  );

  assertEquals(result.embedded, 3, 'three of the four rows carry an image');
  assertEquals(result.skipped, ['30000000-0000-4000-8000-000000000003'], 'the imageless row is reported, not hidden');
  assertEquals(result.unavailable, []);
  assertEquals(parts.length, 1);
  assertEquals(parts[0].receiptCount, 3);

  const { text, pages } = await pdfText(parts[0].bytes);
  assertEquals(pages, 3, 'one page per image');
  const order = ['Whole Foods Market', 'Bäckerei Müller', 'Paddington Cabs'].map((merchant) => text.indexOf(merchant));
  assertEquals(order, [...order].sort((a, b) => a - b), 'pages must stay in date order');
  assert(order.every((index) => index >= 0));
});

Deno.test('images PDF chunks when a run is too large for one file', async () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    ...ROWS[0],
    id: `40000000-0000-4000-8000-00000000000${index}`,
    image_path: `user/${index}.jpg`,
    txn_date: `2026-07-0${index + 1}`,
  }));

  const parts = [];
  const result = await buildImagePdfs(many, () => Promise.resolve(tinyJpeg()), (part) => {
    parts.push(part);
    return Promise.resolve();
  }, { perPart: 3 });

  assertEquals(result.parts, 3);
  assertEquals(parts.map((part) => part.receiptCount), [3, 3, 1]);
  assertEquals(parts.map((part) => part.part), [1, 2, 3]);
  assert(parts.every((part) => part.partCount === 3));
  assertEquals(exportFileName({ kind: 'images', date: '2026-08-05', part: 2, part_count: 3 }), 'parse_export_2026-08-05_images_part2of3.pdf');
});

Deno.test('an unreadable image is reported rather than silently dropped', async () => {
  const parts = [];
  const result = await buildImagePdfs(
    ROWS,
    (path) => Promise.resolve(path === 'user/two.jpg' ? null : tinyJpeg()),
    (part) => {
      parts.push(part);
      return Promise.resolve();
    },
  );

  assertEquals(result.embedded, 2);
  assertEquals(result.unavailable, ['30000000-0000-4000-8000-000000000002']);
  assertEquals(parts[0].receiptCount, 2);
});

Deno.test('file names match the playbook', () => {
  assertEquals(exportFileName({ kind: 'workbook', date: '2026-08-05' }), 'parse_export_2026-08-05.xlsx');
  assertEquals(exportFileName({ kind: 'statement', date: '2026-08-05' }), 'parse_export_2026-08-05.pdf');
  assertEquals(exportFileName({ kind: 'images', date: '2026-08-05' }), 'parse_export_2026-08-05_images.pdf');
});

Deno.test('dates are formatted for people, with the timezone stated', () => {
  assertEquals(formatDay('2026-07-02'), '02/07/2026');
  assertEquals(formatDay(null), '—');
  assertEquals(formatDay('nonsense'), 'nonsense');

  // No zone: UTC, labelled.
  assertEquals(formatTimestamp('2026-08-05T17:45:49.674Z'), '05/08/2026 05:45 PM UTC');
  assertEquals(formatTimestamp('2026-08-05T00:10:00.000Z'), '05/08/2026 12:10 AM UTC');
  assertEquals(formatTimestamp('2026-08-05T12:00:00.000Z'), '05/08/2026 12:00 PM UTC');
  assertEquals(formatTimestamp('not a date'), '—');

  // The device's zone, when it sends one. Adelaide is the case that matters:
  // the same instant is the 5th in UTC and the 6th there, so a timestamp
  // rendered in the wrong zone is wrong by a day, not by hours.
  assertEquals(formatTimestamp('2026-08-05T17:45:49.674Z', 'Asia/Kolkata'), '05/08/2026 11:15 PM GMT+5:30');
  assertEquals(formatTimestamp('2026-08-05T17:45:49.674Z', 'America/New_York'), '05/08/2026 01:45 PM EDT');
  assertEquals(formatTimestamp('2026-08-05T17:45:49.674Z', 'Australia/Adelaide'), '06/08/2026 03:15 AM GMT+9:30');

  // A zone the runtime cannot resolve falls back to UTC rather than throwing.
  assertEquals(usableZone('Middle/Earth'), 'UTC');
  assertEquals(usableZone(null), 'UTC');
  assertEquals(usableZone('Europe/London'), 'Europe/London');
  assertEquals(formatTimestamp('2026-08-05T17:45:49.674Z', 'Middle/Earth'), '05/08/2026 05:45 PM UTC');
});
