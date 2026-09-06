/**
 * Region lookup tables for the first-launch currency guess.
 *
 * Two static maps, kept out of `auth/bootstrap.ts` so the guessing *logic*
 * stays readable next to the data it reads. Static for the same reason
 * `currencies.ts` is: this runs on the first launch of an offline install,
 * before any network call, and Hermes' `Intl` coverage varies by platform and
 * build — a table that never changes without a release beats a lookup that
 * answers differently on two devices.
 *
 * Neither map is authoritative about anything. They feed a pre-filled field the
 * user can overwrite, so the cost of a wrong row is one edit, and the cost of a
 * missing row is the same fallback the user would have got anyway.
 */

/**
 * ISO 3166-1 alpha-2 → the currency receipts are actually *priced* in.
 *
 * Circulating currency, not the official ISO assignment, on the two countries
 * where those differ: Panama's balboa exists only as coins and everything is
 * ticketed in USD, and El Salvador's colón left circulation in 2001. Both map
 * to USD. The question this table answers is "what will this person's receipts
 * say", not "what does the standard assign" — which is why PAB and SVC are the
 * only codes in `currencies.ts` that no row here points at.
 *
 * Values are restricted to codes present in `currencies.ts` — a code outside
 * that list would fail `isKnownCurrency` downstream and silently degrade to the
 * final fallback, which is worse than not having the row.
 */
const CURRENCY_BY_COUNTRY: Readonly<Record<string, string>> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD', AO: 'AOA',
  AR: 'ARS', AS: 'USD', AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR', AZ: 'AZN',
  BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'BGN', BH: 'BHD', BI: 'BIF',
  BJ: 'XOF', BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB', BQ: 'USD', BR: 'BRL', BS: 'BSD',
  BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD',
  CA: 'CAD', CC: 'AUD', CD: 'CDF', CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF', CK: 'NZD',
  CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP', CV: 'CVE', CW: 'ANG',
  CX: 'AUD', CY: 'EUR', CZ: 'CZK',
  DE: 'EUR', DJ: 'DJF', DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD',
  EC: 'USD', EE: 'EUR', EG: 'EGP', EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB',
  FI: 'EUR', FJ: 'FJD', FK: 'FKP', FM: 'USD', FO: 'DKK', FR: 'EUR',
  GA: 'XAF', GB: 'GBP', GD: 'XCD', GE: 'GEL', GF: 'EUR', GG: 'GBP', GH: 'GHS', GI: 'GIP',
  GL: 'DKK', GM: 'GMD', GN: 'GNF', GP: 'EUR', GQ: 'XAF', GR: 'EUR', GT: 'GTQ', GU: 'USD',
  GW: 'XOF', GY: 'GYD',
  HK: 'HKD', HN: 'HNL', HR: 'EUR', HT: 'HTG', HU: 'HUF',
  ID: 'IDR', IE: 'EUR', IL: 'ILS', IM: 'GBP', IN: 'INR', IO: 'USD', IQ: 'IQD', IR: 'IRR',
  IS: 'ISK', IT: 'EUR',
  JE: 'GBP', JM: 'JMD', JO: 'JOD', JP: 'JPY',
  KE: 'KES', KG: 'KGS', KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW',
  KW: 'KWD', KY: 'KYD', KZ: 'KZT',
  LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF', LK: 'LKR', LR: 'LRD', LS: 'LSL', LT: 'EUR',
  LU: 'EUR', LV: 'EUR', LY: 'LYD',
  MA: 'MAD', MC: 'EUR', MD: 'MDL', ME: 'EUR', MF: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD',
  ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP', MP: 'USD', MQ: 'EUR', MR: 'MRU', MS: 'XCD',
  MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN',
  NA: 'NAD', NC: 'XPF', NE: 'XOF', NF: 'AUD', NG: 'NGN', NI: 'NIO', NL: 'EUR', NO: 'NOK',
  NP: 'NPR', NR: 'AUD', NU: 'NZD', NZ: 'NZD',
  OM: 'OMR',
  PA: 'USD', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN', PM: 'EUR',
  PN: 'NZD', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG',
  QA: 'QAR',
  RE: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF',
  SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR',
  SJ: 'NOK', SK: 'EUR', SL: 'SLE', SM: 'EUR', SN: 'XOF', SO: 'SOS', SR: 'SRD', SS: 'SSP',
  ST: 'STN', SV: 'USD', SX: 'ANG', SY: 'SYP', SZ: 'SZL',
  TC: 'USD', TD: 'XAF', TG: 'XOF', TH: 'THB', TJ: 'TJS', TK: 'NZD', TL: 'USD', TM: 'TMT',
  TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TV: 'AUD', TW: 'TWD', TZ: 'TZS',
  UA: 'UAH', UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS',
  VA: 'EUR', VC: 'XCD', VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND', VU: 'VUV',
  WF: 'XPF', WS: 'WST',
  YE: 'YER', YT: 'EUR',
  ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};

/**
 * IANA time zone → ISO 3166-1 alpha-2, deliberately partial.
 *
 * Used only when the device reports no region at all. The zone is a weaker
 * signal than the region setting and must never override it: a US user on a
 * fortnight in Bangalore reads as `Asia/Kolkata`, and switching their default
 * to INR mid-trip is a worse bug than the one this fixes.
 *
 * Partial by design. The full zone list runs past 400 entries, most of them
 * near-identical aliases, and a hand-maintained table that size is a source of
 * silent wrong answers. Covering the world's population centres and returning
 * `null` for everything else keeps every row here one somebody checked — an
 * unmapped zone costs the same fallback as no zone at all.
 *
 * Retired aliases (`Asia/Calcutta`, `Europe/Kiev`) are kept: older Android
 * builds and restored backups still report them.
 */
const COUNTRY_BY_TIME_ZONE: Readonly<Record<string, string>> = {
  'Africa/Abidjan': 'CI', 'Africa/Accra': 'GH', 'Africa/Addis_Ababa': 'ET', 'Africa/Algiers': 'DZ',
  'Africa/Bamako': 'ML', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Dakar': 'SN',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Douala': 'CM', 'Africa/Harare': 'ZW',
  'Africa/Johannesburg': 'ZA', 'Africa/Kampala': 'UG', 'Africa/Khartoum': 'SD',
  'Africa/Kigali': 'RW', 'Africa/Kinshasa': 'CD', 'Africa/Lagos': 'NG', 'Africa/Luanda': 'AO',
  'Africa/Lusaka': 'ZM', 'Africa/Maputo': 'MZ', 'Africa/Nairobi': 'KE',
  'Africa/Ouagadougou': 'BF', 'Africa/Tripoli': 'LY', 'Africa/Tunis': 'TN',
  'America/Anchorage': 'US', 'America/Argentina/Buenos_Aires': 'AR', 'America/Asuncion': 'PY',
  'America/Bogota': 'CO', 'America/Caracas': 'VE', 'America/Chicago': 'US',
  'America/Costa_Rica': 'CR', 'America/Denver': 'US', 'America/Edmonton': 'CA',
  'America/El_Salvador': 'SV', 'America/Guatemala': 'GT', 'America/Guayaquil': 'EC',
  'America/Halifax': 'CA', 'America/Havana': 'CU', 'America/Jamaica': 'JM',
  'America/La_Paz': 'BO', 'America/Lima': 'PE', 'America/Los_Angeles': 'US',
  'America/Managua': 'NI', 'America/Mexico_City': 'MX', 'America/Montevideo': 'UY',
  'America/Nassau': 'BS', 'America/New_York': 'US', 'America/Panama': 'PA',
  'America/Phoenix': 'US', 'America/Port-au-Prince': 'HT', 'America/Puerto_Rico': 'PR',
  'America/Regina': 'CA', 'America/Santiago': 'CL', 'America/Santo_Domingo': 'DO',
  'America/Sao_Paulo': 'BR', 'America/St_Johns': 'CA', 'America/Tegucigalpa': 'HN',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Winnipeg': 'CA',
  'Asia/Almaty': 'KZ', 'Asia/Amman': 'JO', 'Asia/Ashgabat': 'TM', 'Asia/Baghdad': 'IQ',
  'Asia/Bahrain': 'BH', 'Asia/Baku': 'AZ', 'Asia/Bangkok': 'TH', 'Asia/Beirut': 'LB',
  'Asia/Bishkek': 'KG', 'Asia/Calcutta': 'IN', 'Asia/Colombo': 'LK', 'Asia/Damascus': 'SY',
  'Asia/Dhaka': 'BD', 'Asia/Dubai': 'AE', 'Asia/Dushanbe': 'TJ', 'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Hong_Kong': 'HK', 'Asia/Jakarta': 'ID', 'Asia/Jerusalem': 'IL', 'Asia/Kabul': 'AF',
  'Asia/Karachi': 'PK', 'Asia/Katmandu': 'NP', 'Asia/Kathmandu': 'NP', 'Asia/Kolkata': 'IN',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuwait': 'KW', 'Asia/Macau': 'MO', 'Asia/Manila': 'PH',
  'Asia/Muscat': 'OM', 'Asia/Phnom_Penh': 'KH', 'Asia/Qatar': 'QA', 'Asia/Riyadh': 'SA',
  'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Singapore': 'SG', 'Asia/Taipei': 'TW',
  'Asia/Tashkent': 'UZ', 'Asia/Tbilisi': 'GE', 'Asia/Tehran': 'IR', 'Asia/Thimphu': 'BT',
  'Asia/Tokyo': 'JP', 'Asia/Ulaanbaatar': 'MN', 'Asia/Vientiane': 'LA', 'Asia/Yangon': 'MM',
  'Asia/Yerevan': 'AM',
  'Atlantic/Canary': 'ES', 'Atlantic/Reykjavik': 'IS',
  'Australia/Adelaide': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Melbourne': 'AU',
  'Australia/Perth': 'AU', 'Australia/Sydney': 'AU',
  'Europe/Amsterdam': 'NL', 'Europe/Athens': 'GR', 'Europe/Belgrade': 'RS', 'Europe/Berlin': 'DE',
  'Europe/Bratislava': 'SK', 'Europe/Brussels': 'BE', 'Europe/Bucharest': 'RO',
  'Europe/Budapest': 'HU', 'Europe/Chisinau': 'MD', 'Europe/Copenhagen': 'DK',
  'Europe/Dublin': 'IE', 'Europe/Helsinki': 'FI', 'Europe/Istanbul': 'TR', 'Europe/Kiev': 'UA',
  'Europe/Kyiv': 'UA', 'Europe/Lisbon': 'PT', 'Europe/Ljubljana': 'SI', 'Europe/London': 'GB',
  'Europe/Luxembourg': 'LU', 'Europe/Madrid': 'ES', 'Europe/Malta': 'MT', 'Europe/Minsk': 'BY',
  'Europe/Moscow': 'RU', 'Europe/Oslo': 'NO', 'Europe/Paris': 'FR', 'Europe/Prague': 'CZ',
  'Europe/Riga': 'LV', 'Europe/Rome': 'IT', 'Europe/Sarajevo': 'BA', 'Europe/Skopje': 'MK',
  'Europe/Sofia': 'BG', 'Europe/Stockholm': 'SE', 'Europe/Tallinn': 'EE', 'Europe/Tirane': 'AL',
  'Europe/Vienna': 'AT', 'Europe/Vilnius': 'LT', 'Europe/Warsaw': 'PL', 'Europe/Zagreb': 'HR',
  'Europe/Zurich': 'CH',
  'Indian/Maldives': 'MV', 'Indian/Mauritius': 'MU',
  'Pacific/Auckland': 'NZ', 'Pacific/Fiji': 'FJ', 'Pacific/Guam': 'GU', 'Pacific/Honolulu': 'US',
  'Pacific/Port_Moresby': 'PG',
};

/** The currency receipts are priced in for an ISO 3166-1 alpha-2 code. */
export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return CURRENCY_BY_COUNTRY[country.trim().toUpperCase()] ?? null;
}

/** The country for an IANA zone, or null when the zone is not one we mapped. */
export function countryForTimeZone(timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  return COUNTRY_BY_TIME_ZONE[timeZone.trim()] ?? null;
}
