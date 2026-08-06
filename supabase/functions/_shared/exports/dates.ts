// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Dates as a person reads them.
 *
 * Exports used to print the raw ISO timestamp — `2026-08-05T17:45:49.674Z` —
 * which is precise and unreadable. Two formats replace it: a day, and a day with
 * a time.
 *
 * The timezone is stated rather than assumed. An edge function runs in UTC and
 * has no idea where the user is, so rendering UTC without saying so would
 * silently mislabel the time by up to a day at the edges. Until the client sends
 * its timezone with the request, "UTC" on the page is the honest version.
 */
const MONTH_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-07-02` → `02/07/2026`. Returns an em dash when there is no date. */
export function formatDay(value: unknown): string {
  if (typeof value !== 'string') return '—';
  const match = MONTH_DAY.exec(value.trim());
  if (!match) return value.trim() || '—';
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * An instant, in the reader's timezone → `05/08/2026 11:15 PM GMT+5:30`.
 *
 * The zone comes from the device and travels with the job, because the file may
 * be built minutes later by the sweeper in a process that knows nothing about
 * the user. It is always labelled: the same instant is the 5th in Chicago and
 * the 6th in Adelaide, so a bare date would be wrong for half the world.
 *
 * An unusable zone falls back to UTC rather than failing. A timezone the runtime
 * has never heard of is a display detail, and losing an export over one would be
 * a poor trade.
 */
export function formatTimestamp(value: unknown, timeZone?: string | null): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '—';

  const zone = usableZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(date);

  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')} ${part('timeZoneName')}`;
}

/** The zone if the runtime can format in it, otherwise UTC. */
export function usableZone(timeZone?: string | null): string {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return timeZone.trim();
  } catch {
    return 'UTC';
  }
}
