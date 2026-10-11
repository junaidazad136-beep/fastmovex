import { intlLocale, type Locale } from './i18n/config';

/** Dates are shown in the market's time zone (Qatar), not the server's or a traveller's device zone. */
export const MARKET_TIME_ZONE = 'Asia/Qatar';

export function formatDate(iso: string | Date, locale: Locale, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: MARKET_TIME_ZONE, ...opts }).format(d);
}

export function formatDateTime(iso: string | Date, locale: Locale): string {
  return formatDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), opts).format(n);
}

/** Bidi-safe rendering of Latin identifiers (order numbers, phone numbers) inside Arabic text. */
export function ltr(s: string): string {
  return `⁦${s}⁩`;
}
