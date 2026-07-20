import type { Category } from './types';

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
