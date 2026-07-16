/**
 * Deterministic receipt-date normalization. The LLM returns the date string as
 * printed; this resolves format/ambiguity in code (PM decision 2026-07-10) —
 * see HANDOFF rule 8: deterministic logic belongs in code, not the prompt.
 *
 * Rule: generate every valid calendar reading of the string, then prefer the
 * most recent one that is not in the future — receipts are recent and never
 * future-dated. Returns "YYYY-MM-DD" or null if unparseable.
 *
 * Ported verbatim (types added, logic untouched) from receipt-experiment's
 * dates.js, which carries the unit tests for these rules.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const expandYear = (y: number) => (y >= 100 ? y : y >= 70 ? 1900 + y : 2000 + y);

export function normalizeReceiptDate(raw: unknown, today: Date = new Date()): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const candidates: string[] = [];

  // Month-name formats: "Jul 4, 2026", "4 Jul 2026", "July 4 2026"
  const nm = s.match(/(?:^|\b)(?:(\d{1,2})\s*)?([a-z]{3,9})\.?\s+(\d{1,2})?,?\s*(\d{2,4})/i);
  if (nm) {
    const m = MONTHS[nm[2].slice(0, 4).toLowerCase()] ?? MONTHS[nm[2].slice(0, 3).toLowerCase()];
    const day = Number(nm[1] ?? nm[3]);
    const y = expandYear(Number(nm[4]));
    if (m && day && valid(y, m, day)) candidates.push(iso(y, m, day));
  }

  // Numeric formats with -, /, . or space separators
  const num = s.match(/(\d{1,4})[-/. ](\d{1,2})[-/. ](\d{1,4})/);
  if (num) {
    const [a, b, c] = [Number(num[1]), Number(num[2]), Number(num[3])];
    if (num[1].length === 4 || a > 31) {
      // Year first: ISO order (Y-M-D), swapped only if month slot is invalid
      if (valid(a, b, c)) candidates.push(iso(a, b, c));
      else if (valid(a, c, b)) candidates.push(iso(a, c, b));
    } else {
      // Year last: try both M-D-Y and D-M-Y readings
      const y = expandYear(c);
      if (valid(y, a, b)) candidates.push(iso(y, a, b));
      if (valid(y, b, a) && iso(y, b, a) !== candidates[0]) candidates.push(iso(y, b, a));
    }
  }

  if (candidates.length === 0) return null;
  const todayIso = iso(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const past = candidates.filter((d) => d <= todayIso).sort();
  if (past.length) return past[past.length - 1]; // most recent non-future reading
  return candidates.sort()[0]; // all future (clock skew etc.): closest one
}
