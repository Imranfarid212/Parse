/**
 * The golden set: twenty receipts, their correct answers, and the rules for
 * deciding whether a returned answer counts.
 *
 * Split out from the harness that runs it so the two can be told apart. The
 * gate trusts a committed report only while this file is unchanged (see
 * lib/golden-fingerprint.js), and that guarantee is only useful if it tracks
 * what the answers depend on. Rewording a log line in golden-b4.js must not
 * cost twenty live model calls; changing a fixture, a threshold or a matching
 * rule must.
 */

// Playbook B4 / T4.2.
const THRESHOLDS = {
  fieldAccuracy: 0.9, // merchant, txn_date, total — each, exactly
  categoryInList: 1.0, // no off-list value may survive the server fallback
  balancedAverageRoundTripMs: 2500,
  preciseAverageToUiMs: 4500,
};

/** The categories this user has picked. A subset, on purpose — see the header. */
const OFFERED_CATEGORY_IDS = [1, 2, 3, 5, 10]; // Travel, Meals, Office, Vehicle, Miscellaneous

/**
 * Twenty receipts with known answers.
 *
 * Chosen to be awkward in the ways real receipts are: totals that are not the
 * last number on the page, tips and discounts below the total, several date
 * formats, non-USD currencies, a fuel receipt whose litre price looks like a
 * total, and two whose correct category is off the user's offered list and must
 * come back as Miscellaneous. Merchants and totals are all distinct so the
 * duplicate check has nothing to latch onto.
 *
 * `expect.merchant` is the merchant line AS PRINTED, store number and all —
 * `Shell Station 4471`, not `Shell`. The first full run scored 80% merchant
 * because the key had been written with tidied brand names the receipts never
 * state; all four "misses" were faithful transcriptions. Asking for `Shell`
 * would be asking the model to guess. If a future run disagrees with the key,
 * check the fixture text before assuming the model is wrong — but only change
 * the key when the receipt itself supports it.
 */
const GOLDEN = [
  {
    id: 'g01-coffee-us',
    text: [
      'BLUE BOTTLE COFFEE',
      '66 Mint St, San Francisco CA',
      '2026-07-14  10:32',
      'Latte              4.50',
      'Croissant          3.75',
      'Subtotal           8.25',
      'Tax                0.74',
      'TOTAL              8.99',
      'VISA ****4471  APPROVED',
    ].join('\n'),
    expect: { merchant: 'Blue Bottle Coffee', txn_date: '2026-07-14', total: 8.99, currency: 'USD' },
  },
  {
    id: 'g02-grocery-tip-below-total',
    text: [
      'WHOLE FOODS MARKET #1042',
      '399 4th Street',
      'Date: 03/11/2026   Time: 18:04',
      'Organic Bananas  1.29',
      'Sourdough Loaf   5.50',
      'Almond Milk      4.79',
      'Oat Yogurt       3.20',
      'SUBTOTAL        14.78',
      'TAX              1.29',
      'TOTAL           16.07',
      'Cash Back        20.00',
      'Change Due        3.93',
    ].join('\n'),
    expect: { merchant: 'Whole Foods Market #1042', txn_date: '2026-03-11', total: 16.07, currency: 'USD' },
  },
  {
    id: 'g03-restaurant-tip',
    text: [
      'THE ANCHOR TAVERN',
      'Table 12   Server: Dana',
      '2026-05-02',
      'Fish & Chips        18.00',
      'House Salad          9.50',
      'Sparkling Water      4.00',
      'Subtotal            31.50',
      'Sales Tax            2.83',
      'TOTAL               34.33',
      'Suggested tip 18%    6.18',
      'Suggested tip 20%    6.87',
    ].join('\n'),
    expect: { merchant: 'The Anchor Tavern', txn_date: '2026-05-02', total: 34.33, currency: 'USD' },
  },
  {
    id: 'g04-fuel-litre-price-trap',
    text: [
      'SHELL STATION 4471',
      'A12 Colchester Road',
      '18 JUN 2026  07:41',
      'UNLEADED',
      'Litres        44.20',
      'Price/L        1.49',
      'Pump 3',
      'AMOUNT DUE   GBP 65.86',
      'CONTACTLESS',
    ].join('\n'),
    expect: { merchant: 'Shell Station 4471', txn_date: '2026-06-18', total: 65.86, currency: 'GBP' },
  },
  {
    id: 'g05-office-supplies',
    text: [
      'STAPLES STORE 0912',
      'Receipt 88213',
      '2026-01-27',
      'Copy Paper A4 5x   24.95',
      'Ballpoint Pens     6.49',
      'Stapler           12.99',
      'SUBTOTAL          44.43',
      'TAX                3.55',
      'TOTAL             47.98',
    ].join('\n'),
    expect: { merchant: 'Staples Store 0912', txn_date: '2026-01-27', total: 47.98, currency: 'USD' },
  },
  {
    id: 'g06-taxi',
    text: [
      'CITY CAB CO.',
      'Medallion 8814',
      'Feb 9, 2026  23:12',
      'Fare              21.40',
      'Night surcharge    1.00',
      'Tolls              6.55',
      'Tip                5.00',
      'TOTAL             33.95',
    ].join('\n'),
    expect: { merchant: 'City Cab Co.', txn_date: '2026-02-09', total: 33.95, currency: 'USD' },
  },
  {
    id: 'g07-hotel-eur',
    text: [
      'HOTEL ADLER',
      'Rheinstrasse 14, Koln',
      'Rechnung 2026-0412',
      'Datum: 22.04.2026',
      'Ubernachtung 2 Nachte   240,00',
      'Fruhstuck                28,00',
      'Zwischensumme           268,00',
      'MwSt 7%                  18,76',
      'GESAMT EUR              286,76',
    ].join('\n'),
    expect: { merchant: 'Hotel Adler', txn_date: '2026-04-22', total: 286.76, currency: 'EUR' },
  },
  {
    id: 'g08-pharmacy-off-list',
    text: [
      'BOOTS PHARMACY',
      '12 High Street, Reading',
      '05/09/2026',
      'Ibuprofen 200mg     3.29',
      'Vitamin D Tablets   7.99',
      'Plasters            2.49',
      'TOTAL GBP          13.77',
      'DEBIT CARD',
    ].join('\n'),
    // Healthcare is not on the offered list; the server must return Miscellaneous.
    expect: { merchant: 'Boots Pharmacy', txn_date: '2026-09-05', total: 13.77, currency: 'GBP' },
  },
  {
    id: 'g09-hardware-discount',
    text: [
      'HOME DEPOT #6612',
      '2026-08-15',
      'Drill Bit Set      29.97',
      'Wood Screws 100ct   8.47',
      'Sandpaper Pack      5.98',
      'Subtotal           44.42',
      'MEMBER DISCOUNT    -4.44',
      'Taxable            39.98',
      'Tax                 3.20',
      'TOTAL              43.18',
    ].join('\n'),
    expect: { merchant: 'Home Depot #6612', txn_date: '2026-08-15', total: 43.18, currency: 'USD' },
  },
  {
    id: 'g10-software-invoice',
    text: [
      'FIGMA, INC.',
      'Invoice #INV-88213',
      'Issued: March 1, 2026',
      'Professional Plan, 3 seats',
      'Billing period Mar 1 - Mar 31',
      'Subtotal            45.00',
      'Tax                  0.00',
      'Amount paid USD     45.00',
    ].join('\n'),
    expect: { merchant: 'Figma, Inc.', txn_date: '2026-03-01', total: 45.0, currency: 'USD' },
  },
  {
    id: 'g11-parking',
    text: [
      'NCP CAR PARK',
      'Bridge Street, Manchester',
      'Entry 09:14  Exit 15:47',
      '11 NOV 2026',
      'Duration 6h 33m',
      'Tariff Band C',
      'PAID  GBP 14.50',
    ].join('\n'),
    expect: { merchant: 'NCP Car Park', txn_date: '2026-11-11', total: 14.5, currency: 'GBP' },
  },
  {
    id: 'g12-electronics-multi-total',
    text: [
      'BEST BUY 1123',
      '2026-10-03',
      'USB-C Hub          59.99',
      'HDMI Cable 2m      18.99',
      'Screen Cleaner      7.49',
      'MERCHANDISE TOTAL  86.47',
      'Tax                 6.92',
      'ORDER TOTAL        93.39',
      'Amount tendered   100.00',
      'Change              6.61',
    ].join('\n'),
    expect: { merchant: 'Best Buy', txn_date: '2026-10-03', total: 93.39, currency: 'USD' },
  },
  {
    id: 'g13-courier',
    text: [
      'FEDEX OFFICE',
      'Ship date 2026-07-29',
      'Tracking 7712 8841 0093',
      'Ground, 2 lbs, zone 5',
      'Shipping           14.20',
      'Signature required  4.50',
      'Fuel surcharge      1.31',
      'TOTAL              20.01',
    ].join('\n'),
    expect: { merchant: 'FedEx Office', txn_date: '2026-07-29', total: 20.01, currency: 'USD' },
  },
  {
    id: 'g14-lunch-small',
    text: [
      'PRET A MANGER',
      '2026-02-18  12:41',
      'Chicken Avo Wrap    5.25',
      'Filter Coffee       1.99',
      'TOTAL GBP           7.24',
    ].join('\n'),
    expect: { merchant: 'Pret A Manger', txn_date: '2026-02-18', total: 7.24, currency: 'GBP' },
  },
  {
    id: 'g15-vehicle-service',
    text: [
      "KWIK FIT AUTOCENTRE",
      'Job card 44120',
      'Date 30/05/2026',
      'Vehicle reg BX58 KLM',
      'Front brake pads      89.00',
      'Labour 1.5h           67.50',
      'Net                  156.50',
      'VAT 20%               31.30',
      'TOTAL DUE GBP        187.80',
    ].join('\n'),
    expect: { merchant: 'Kwik Fit Autocentre', txn_date: '2026-05-30', total: 187.8, currency: 'GBP' },
  },
  {
    id: 'g16-airline',
    text: [
      'UNITED AIRLINES',
      'e-Ticket receipt',
      'Issued 2026-06-04',
      'SFO - ORD  UA 512',
      'Base fare          214.00',
      'Taxes and fees      38.60',
      'Seat selection      21.00',
      'TOTAL CHARGED USD  273.60',
    ].join('\n'),
    expect: { merchant: 'United Airlines', txn_date: '2026-06-04', total: 273.6, currency: 'USD' },
  },
  {
    id: 'g17-convenience-off-list',
    text: [
      'PETSMART 2214',
      '2026-09-19',
      'Dry Dog Food 12kg   42.99',
      'Chew Toy             9.49',
      'Subtotal            52.48',
      'Tax                  4.20',
      'TOTAL               56.68',
    ].join('\n'),
    // Nothing on the offered list fits; expect the Miscellaneous fallback.
    expect: { merchant: 'PetSmart 2214', txn_date: '2026-09-19', total: 56.68, currency: 'USD' },
  },
  {
    id: 'g18-faded-thermal',
    text: [
      'T R A D E R   J O E S',
      'store 0455',
      '12-22-2026',
      'Frozen Dumplings    4.49',
      'Mandarin Oranges    3.99',
      'Dark Chocolate      2.29',
      'Sparkling Water     3.49',
      'ITEMS 4',
      'TOTAL              14.26',
    ].join('\n'),
    expect: { merchant: 'Trader Joes', txn_date: '2026-12-22', total: 14.26, currency: 'USD' },
  },
  {
    id: 'g19-coworking',
    text: [
      'WEWORK',
      '2026-04-01',
      'Hot desk day pass x2   58.00',
      'Meeting room 1h        25.00',
      'Subtotal               83.00',
      'Tax                     6.64',
      'TOTAL                  89.64',
    ].join('\n'),
    expect: { merchant: 'WeWork', txn_date: '2026-04-01', total: 89.64, currency: 'USD' },
  },
  {
    id: 'g20-train-gbp',
    text: [
      'TRAINLINE',
      'Booking ref 8KL22P',
      'Travel date 07 Jul 2026',
      'London Euston to Manchester Pic',
      'Advance single         41.30',
      'Booking fee             0.00',
      'TOTAL PAID GBP         41.30',
    ].join('\n'),
    expect: { merchant: 'Trainline', txn_date: '2026-07-07', total: 41.3, currency: 'GBP' },
  },
];

/**
 * "Exact" for a merchant name, without being defeated by things that are not
 * part of the merchant's identity.
 *
 * Case, punctuation and legal suffixes are noise. So is the store number: the
 * first smoke run returned `WHOLE FOODS MARKET #1042`, which is what the receipt
 * says and is the same merchant as `WHOLE FOODS MARKET` for every purpose the
 * product has — search and grouping in B6 both key on the name. Six of the
 * twenty fixtures carry a store number, so leaving it in would measure this
 * normalizer rather than the model.
 *
 * Both comparisons are recorded per sample — `merchant` (normalized, the
 * threshold) and `merchant_strict` (case-folded raw). The looser one is the
 * gate because it is the one that means something, not because it is looser,
 * and the stricter number stays visible so that claim can be checked.
 */
function normalizeMerchant(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[.,'`’]/g, '')
    .replace(/\b(inc|llc|ltd|plc|gmbh|co|corp|company)\b/g, '')
    .replace(/\b(store|shop|branch|no)\b/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+\d{3,}\b/g, ' ') // trailing store number, e.g. "staples 0912"
    .trim();
}

const casefold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const money = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null);

module.exports = { THRESHOLDS, OFFERED_CATEGORY_IDS, GOLDEN, normalizeMerchant, casefold, money };
