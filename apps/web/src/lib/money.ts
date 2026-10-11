import { intlLocale, type Locale } from './i18n/config';

/**
 * Money arrives from the API as a string of minor units ("10000" = QAR 100.00). It is never turned into a float:
 * the string is split into whole and fractional parts, and Intl formats the exact decimal string.
 */
export function minorToDecimalString(minor: string | bigint, minorUnits = 2): string {
  let v = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(minorUnits);
  const whole = v / base;
  const frac = (v % base).toString().padStart(minorUnits, '0');
  return `${neg ? '-' : ''}${whole}${minorUnits > 0 ? `.${frac}` : ''}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: Locale, currency: string, minorUnits: number, hideZeroFraction: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${minorUnits}|${hideZeroFraction}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      // "QAR 1,234.50" in English, "1,234.50 ر.ق." in Arabic — what shoppers in Qatar are used to seeing
      currencyDisplay: locale === 'ar' ? 'symbol' : 'code',
      minimumFractionDigits: hideZeroFraction ? 0 : minorUnits,
      maximumFractionDigits: minorUnits,
    });
    formatters.set(key, f);
  }
  return f;
}

export interface MoneyOptions {
  minorUnits?: number;
  /** "QAR 100" instead of "QAR 100.00" — for compact cards. Never hides non-zero fils. */
  compact?: boolean;
}

export function formatMoney(minor: string | bigint | null | undefined, currency: string, locale: Locale, opts: MoneyOptions = {}): string {
  if (minor === null || minor === undefined || minor === '') return '';
  const minorUnits = opts.minorUnits ?? 2;
  const dec = minorToDecimalString(minor, minorUnits);
  const zeroFraction = /\.0+$/.test(dec) || minorUnits === 0;
  const f = formatter(locale, currency, minorUnits, !!opts.compact && zeroFraction);
  // Intl.NumberFormat accepts exact decimal strings (ES2023). Typed as number for older lib typings.
  return f.format(dec as unknown as number).replace(/ /g, ' ');
}

/** "150.5" / "150" typed by a user → minor units string, or null when invalid. */
export function decimalToMinor(input: string, minorUnits = 2): string | null {
  const s = input.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(',', '.');
  if (!/^\d{1,10}(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > minorUnits) return null;
  return (BigInt(whole) * 10n ** BigInt(minorUnits) + BigInt((frac.padEnd(minorUnits, '0') || '0'))).toString();
}

export function minorSub(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString();
}

export function percentOff(priceMinor: string, compareAtMinor: string | null | undefined): number {
  if (!compareAtMinor) return 0;
  const p = BigInt(priceMinor);
  const c = BigInt(compareAtMinor);
  if (c <= p) return 0;
  return Number(((c - p) * 100n) / c);
}
