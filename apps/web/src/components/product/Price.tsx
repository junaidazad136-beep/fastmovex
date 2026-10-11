import type { Locale } from '@/lib/i18n/config';
import { formatMoney, percentOff } from '@/lib/money';

export interface PriceInput {
  priceMinor: string;
  compareAtMinor: string | null;
  dealPriceMinor?: string | null;
}

/**
 * What the shopper pays now, and what it is compared with.
 * A live deal wins over the regular price; the struck-through price is the higher of the regular and "compare at" prices.
 */
export function effectivePrice(p: PriceInput): { now: string; was: string | null; percent: number; onDeal: boolean } {
  const onDeal = !!p.dealPriceMinor && BigInt(p.dealPriceMinor) < BigInt(p.priceMinor);
  const now = onDeal ? p.dealPriceMinor! : p.priceMinor;
  const candidates = [onDeal ? p.priceMinor : null, p.compareAtMinor].filter((x): x is string => !!x && BigInt(x) > BigInt(now));
  const was = candidates.length ? candidates.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b)) : null;
  return { now, was, percent: percentOff(now, was), onDeal };
}

export function Price({
  input, currency, minorUnits = 2, locale, size = 'md', showPercent = false, percentLabel,
}: {
  input: PriceInput;
  currency: string;
  minorUnits?: number;
  locale: Locale;
  size?: 'sm' | 'md' | 'lg';
  showPercent?: boolean;
  percentLabel?: (n: number) => string;
}) {
  const { now, was, percent, onDeal } = effectivePrice(input);
  const nowCls = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-[15px]' : 'text-lg';
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={`tabular font-bold ${nowCls} ${onDeal ? 'text-deal-600' : 'text-ink-900'}`} data-testid="price-now">
        {formatMoney(now, currency, locale, { minorUnits, compact: size === 'sm' })}
      </span>
      {was && (
        <span className="tabular text-[13px] text-ink-400 line-through" data-testid="price-was">
          {formatMoney(was, currency, locale, { minorUnits, compact: size === 'sm' })}
        </span>
      )}
      {showPercent && percent > 0 && percentLabel && (
        <span className="rounded-md bg-deal-500/10 px-1.5 py-0.5 text-xs font-bold text-deal-600">{percentLabel(percent)}</span>
      )}
    </div>
  );
}
