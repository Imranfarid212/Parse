import * as Localization from 'expo-localization';

export type BootstrapLocale = {
  country: string | null;
  defaultCurrency: string;
};

const currencyByCountry: Record<string, string> = {
  AU: 'AUD',
  CA: 'CAD',
  EU: 'EUR',
  GB: 'GBP',
  IN: 'INR',
  JP: 'JPY',
  SG: 'SGD',
  US: 'USD',
};

export function getBootstrapLocale(): BootstrapLocale {
  const locale = Localization.getLocales()[0];
  const country = locale?.regionCode?.toUpperCase() ?? null;
  const currency = locale?.currencyCode?.toUpperCase() ?? (country ? currencyByCountry[country] : null) ?? 'USD';

  return {
    country,
    defaultCurrency: currency,
  };
}
