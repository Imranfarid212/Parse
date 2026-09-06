/**
 * The first-launch locale guess: what to pre-fill before the user has told us
 * anything and before a profile exists to read.
 *
 * Everything here is synchronous, permissionless and offline — `getLocales()`
 * and `getCalendars()` read OS settings already resolved on the device, so this
 * is answerable on the first frame of a cold install with the radio off.
 *
 * It is a *guess*, and the value it produces is always editable. The device
 * region is a setting, not a location: someone who configured their phone in
 * the US and now files receipts in Bangalore reads as `US`/USD, and no API
 * fixes that — only asking does. So the job here is to be right for the common
 * case and cheap to correct for the rest, never to be clever.
 */
import * as Localization from 'expo-localization';

import { isKnownCurrency } from '@/lib/currencies';
import { countryForTimeZone, currencyForCountry } from '@/lib/locale-regions';

export type BootstrapLocale = {
  country: string | null;
  defaultCurrency: string;
};

/**
 * Where we land when the device tells us nothing usable. Not a claim about the
 * user — just the most common denomination among receipts we can't place.
 */
const FALLBACK_CURRENCY = 'USD';

/**
 * OS locale reads, guarded.
 *
 * This runs on the critical first-launch path, ahead of the onboarding screen
 * it feeds. Every caller of these values already has a fallback, so a throw
 * from the platform module should cost the guess, not the launch.
 */
function readLocale(): Localization.Locale | null {
  try {
    return Localization.getLocales()[0] ?? null;
  } catch {
    return null;
  }
}

function readTimeZone(): string | null {
  try {
    return Localization.getCalendars()[0]?.timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * A currency code we are willing to hand to the rest of the app.
 *
 * `currencyCode` is documented as locale-derived on Android and null on web, so
 * it is not guaranteed to be a code our picker knows. Validating here means an
 * unrecognised value degrades to the next signal rather than being stored and
 * later rendered as "Current currency" on the settings screen.
 */
function knownCurrencyOrNull(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  return normalized && isKnownCurrency(normalized) ? normalized : null;
}

export function getBootstrapLocale(): BootstrapLocale {
  const locale = readLocale();

  // Region first, time zone only to fill a gap. The zone tracks where the
  // device *is* and the region tracks how it was configured, so on a two-week
  // trip they disagree and the region is the one that reflects a decision the
  // user actually made. Preferring the zone would rewrite a traveller's
  // currency mid-trip — a worse bug than the one it would fix.
  const country = locale?.regionCode?.toUpperCase() || countryForTimeZone(readTimeZone());

  const currency =
    knownCurrencyOrNull(locale?.currencyCode) ??
    knownCurrencyOrNull(currencyForCountry(country)) ??
    FALLBACK_CURRENCY;

  return {
    country: country ?? null,
    defaultCurrency: currency,
  };
}
