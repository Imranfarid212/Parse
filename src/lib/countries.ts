/**
 * Country list for the onboarding picker.
 *
 * Deliberately NOT all 243 rows of `CURRENCY_BY_COUNTRY`. This list exists to
 * be scrolled by a person on their first launch, and a complete ISO list buries
 * the handful of answers almost everyone needs. Every code here resolves
 * through `currencyForCountry`, so picking any of them yields a real currency.
 *
 * A device whose detected region is NOT on this list is not broken: onboarding
 * keeps the detected code, shows it, and still derives the right currency from
 * the full map. The list is a shortcut, not a gate — which is also why adding a
 * row is safe and removing one costs nothing but a scroll.
 *
 * Static, for the same reason `currencies.ts` and `locale-regions.ts` are:
 * this runs on the first launch of an offline install, and Hermes' `Intl`
 * coverage — `Intl.DisplayNames` in particular — varies by platform and build.
 * A table that only changes with a release beats a lookup that answers
 * differently on two devices.
 */
export type Country = { code: string; name: string };

/** Sorted by name, which is the order the picker shows them in. */
export const COUNTRIES: readonly Country[] = [
  { code: 'AR', name: 'Argentina' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EG', name: 'Egypt' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GR', name: 'Greece' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NP', name: 'Nepal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
] as const;

const BY_CODE: Readonly<Record<string, Country>> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c]),
);

/** The display name for a code, or null when it is not one of the listed ones. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return BY_CODE[code.trim().toUpperCase()]?.name ?? null;
}

/**
 * Matches on name OR code, so both "united" and "AE" find something. Code
 * matches are prefix-only: a two-letter query should not surface every country
 * whose name happens to contain those letters.
 */
export function searchCountries(query: string): readonly Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRIES;
  return COUNTRIES.filter(
    (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().startsWith(q),
  );
}
