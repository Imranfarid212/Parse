import type { Category, ExportReceiptRow } from './types';

export const categoryFixtures: Category[] = [
  { id: 1, name: 'Travel & Transit', is_default: true, is_system: false },
  { id: 2, name: 'Meals & Entertainment', is_default: true, is_system: false },
  { id: 3, name: 'Office Supplies', is_default: true, is_system: false },
  { id: 4, name: 'Software & IT', is_default: true, is_system: false },
  { id: 5, name: 'Vehicle Expenses', is_default: true, is_system: false },
  { id: 6, name: 'Advertising & Marketing', is_default: true, is_system: false },
  { id: 7, name: 'Professional Services', is_default: true, is_system: false },
  { id: 8, name: 'Utilities & Telecom', is_default: true, is_system: false },
  { id: 9, name: 'Inventory & Materials', is_default: true, is_system: false },
  { id: 10, name: 'Miscellaneous', is_default: true, is_system: true },
];

export const extractRequestFixture = {
  capture_id: '11111111-1111-4111-8111-111111111111',
  mode: 'default',
  captured_at: '2026-07-19T00:00:00.000Z',
  image: {
    uri: 'file:///receiptflow/fixtures/receipt.jpg',
    content_type: 'image/jpeg',
    byte_size: 183_000,
  },
} as const;

export const extractionResultFixture = {
  merchant: 'Whole Foods Market',
  txn_date: '2026-07-01',
  currency: 'USD',
  total: 73.36,
  line_items: [{ name: 'Organic bananas 1.2 lb', qty: 1, amount: 1.74 }],
  suggested_category: 'Meals & Entertainment',
  is_receipt: true,
} as const;

export const malformedExtractionFixture =
  '{"merchant":"Whole Foods Market","txn_date":"2026-07-01","currency":"USD","total":73.36,"line_items":[{"name":"Organic bananas 1.2 lb","qty":1,"amount":1.74}],"suggested_category":"Meals & Entertainment","is_receipt":true';

export const offListCategoryExtractionFixture = {
  merchant: 'City Hardware',
  txn_date: '2026-07-01',
  currency: 'USD',
  total: 28.42,
  line_items: [{ name: 'Shelf brackets', qty: 2, amount: 28.42 }],
  suggested_category: 'Home Improvement',
  is_receipt: true,
} as const;

export const exportRequestFixture = {
  filters: {
    date_from: '2026-07-01',
    date_to: '2026-07-31',
    category_ids: [2, 10],
    amount_min: 5,
    amount_max: 500,
    amount_currency: 'USD',
  },
  format: 'xlsx',
  include_images: true,
} as const;

/**
 * Three currencies, two categories, one receipt with no image and one with a
 * name outside Latin-1 — the four cases every export builder has to survive.
 * Both the builder tests and the staging harness assert against these totals,
 * so a subtotal is never checked against a number the same code produced.
 */
export const exportReceiptRowsFixture: ExportReceiptRow[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    txn_date: '2026-07-02',
    merchant: 'Whole Foods Market',
    category_name: 'Meals & Entertainment',
    currency: 'USD',
    total: 73.36,
    notes: 'Team lunch',
    image_path: 'user/30000000-0000-4000-8000-000000000001.jpg',
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
    image_path: 'user/30000000-0000-4000-8000-000000000002.jpg',
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
    image_path: 'user/30000000-0000-4000-8000-000000000004.jpg',
    created_at: '2026-07-19T21:05:00.000Z',
    line_items: [],
  },
];

export const nonReceiptExtractionFixture = {
  merchant: 'Rejected image',
  txn_date: '2026-07-01',
  currency: 'USD',
  total: 0,
  line_items: [],
  suggested_category: 'Miscellaneous',
  is_receipt: false,
} as const;
