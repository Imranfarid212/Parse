// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Currency-grouped arithmetic for exports.
 *
 * Two rules are enforced here rather than trusted to each builder, because
 * "money is never summed across currencies" (D13) is the one mistake an export
 * can make that a user would never spot: every total in this module is produced
 * from rows that share a currency, and there is no function that returns a
 * single number for a mixed set. If you want a grand total, there isn't one.
 *
 * Amounts are summed as integer minor units. Receipt totals are numeric(12,2)
 * in Postgres and arrive as JS numbers; adding 0.1 + 0.2 across a few hundred
 * rows is how a subtotal ends up a cent off the database and fails T7.1.
 */

/** numeric(12,2) → integer cents, with the rounding done once, at the edge. */
export function toMinorUnits(amount: unknown): number {
  const value = typeof amount === 'number' ? amount : Number(amount ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}

/** Fixed two-decimal presentation. Never localized — the export is data. */
export function formatAmount(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/**
 * Rows grouped by currency, currencies in stable alphabetical order and rows
 * inside each currency left in the order the SQL produced (date ascending).
 */
export function groupByCurrency<T extends { currency: string }>(rows: T[]): { currency: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const currency = (row.currency || 'USD').toUpperCase();
    const existing = groups.get(currency);
    if (existing) existing.push(row);
    else groups.set(currency, [row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, currencyRows]) => ({ currency, rows: currencyRows }));
}

/**
 * The subtotal for one currency's rows. Takes the group, not a loose array, so
 * a caller cannot accidentally hand it a mixed set.
 */
export function subtotalFor(group: { currency: string; rows: { currency: string; total: number }[] }): number {
  let minor = 0;
  for (const row of group.rows) {
    if ((row.currency || '').toUpperCase() !== group.currency) {
      throw new Error(`subtotalFor received ${row.currency} inside the ${group.currency} group`);
    }
    minor += toMinorUnits(row.total);
  }
  return fromMinorUnits(minor);
}

/**
 * Per-category totals inside a single currency section, biggest first. This is
 * what the PDF statement prints under each currency heading (T7.2).
 */
export function categoryTotalsFor(group: {
  currency: string;
  rows: { currency: string; total: number; category_name: string | null }[];
}): { category: string; receipts: number; total: number }[] {
  const totals = new Map<string, { receipts: number; minor: number }>();
  for (const row of group.rows) {
    if ((row.currency || '').toUpperCase() !== group.currency) {
      throw new Error(`categoryTotalsFor received ${row.currency} inside the ${group.currency} group`);
    }
    const category = row.category_name?.trim() || 'Miscellaneous';
    const entry = totals.get(category) ?? { receipts: 0, minor: 0 };
    entry.receipts += 1;
    entry.minor += toMinorUnits(row.total);
    totals.set(category, entry);
  }
  return [...totals.entries()]
    .map(([category, entry]) => ({ category, receipts: entry.receipts, total: fromMinorUnits(entry.minor) }))
    .sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : 1));
}
