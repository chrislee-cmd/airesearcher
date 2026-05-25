// Static FX conversion for credit-bundle pricing display.
//
// The product is invoiced in KRW (the bank-transfer flow shows the
// exact KRW amount and Creem charges KRW), so foreign currency here is
// purely informational — it gives users a sense of cost in their own
// money without us taking on the operational burden of live FX rates,
// caching, or fallback handling.
//
// Anchor: ₩1,450 = $1 USD (chosen May 2026). Cross-rates for JPY/THB
// are derived from the USD anchor assuming standard mid-rates at the
// same point in time. Update the constants quarterly or whenever the
// real KRW/USD rate drifts by more than ~5%.

export type CurrencyCode = 'KRW' | 'USD' | 'JPY' | 'THB';

// How many KRW you'd swap for one unit of the target currency.
// Computed once at load; treat as fixed for the life of the deploy.
const KRW_PER_UNIT: Record<CurrencyCode, number> = {
  KRW: 1,
  USD: 1450,
  JPY: 9.6, // derived: 1450 KRW/USD ÷ 151 JPY/USD ≈ 9.6 KRW/JPY
  THB: 39.7, // derived: 1450 KRW/USD ÷ 36.5 THB/USD ≈ 39.7 KRW/THB
};

// Locale → display currency. Locales not listed fall back to KRW so
// the page always renders an integer price; adding a locale here is a
// one-line change.
const LOCALE_TO_CURRENCY: Record<string, CurrencyCode> = {
  ko: 'KRW',
  en: 'USD',
  ja: 'JPY',
  th: 'THB',
};

// next-intl exposes string locales; this normalizes to the currency we
// render for that user.
export function currencyForLocale(locale: string): CurrencyCode {
  return LOCALE_TO_CURRENCY[locale] ?? 'KRW';
}

// KRW → target currency, integer truncation (floor) per spec. We never
// want trailing decimals on a marketing page.
export function convertFromKrw(amountKrw: number, target: CurrencyCode): number {
  if (target === 'KRW') return Math.floor(amountKrw);
  return Math.floor(amountKrw / KRW_PER_UNIT[target]);
}

// Locale-aware number formatting + symbol/suffix. KRW uses the legacy
// "원" suffix the rest of the app already uses; other currencies use
// the standard symbol prefix to match user expectation in those
// locales.
//
// Intl.NumberFormat with `style: 'currency'` would do this in one line
// but applies locale-specific quirks (e.g. JPY with no decimals, USD
// with two, THB with two) that conflict with our "always integer"
// spec, so we format the integer ourselves.
export function formatCurrency(
  amountKrw: number,
  target: CurrencyCode,
): string {
  const value = convertFromKrw(amountKrw, target);
  const grouped = new Intl.NumberFormat('en-US').format(value);
  switch (target) {
    case 'KRW':
      return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
    case 'USD':
      return `$${grouped}`;
    case 'JPY':
      return `¥${grouped}`;
    case 'THB':
      return `฿${grouped}`;
  }
}

// Convenience: render the price in the user's locale-derived currency.
export function formatPriceForLocale(amountKrw: number, locale: string): string {
  return formatCurrency(amountKrw, currencyForLocale(locale));
}
