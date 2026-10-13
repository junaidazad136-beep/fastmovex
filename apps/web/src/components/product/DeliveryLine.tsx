'use client';

import { CalendarClock, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dayLabel, useDeliveryDetails } from '@/lib/delivery-promise';
import { useT } from '@/lib/i18n/client';
import { PAYLATER_MAX_MINOR, PAYLATER_MIN_MINOR } from '@/lib/state/checkout-cart';
import { useMoney, useShop } from '@/lib/state/shop';

/** Minutes left until `iso`, refreshed every 30 seconds (null once it has passed). */
function useMinutesLeft(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const m = Math.floor((new Date(iso).getTime() - now) / 60_000);
  return m > 0 ? m : null;
}

/**
 * Amazon's delivery promise under the price: "FREE delivery Tomorrow, 14 Oct · Order within 2 h 10 min", from the real
 * delivery windows, plus the store's free-delivery threshold when this order would still pay a fee.
 * `goodsMinor` is what these items cost (price × quantity) — delivery is free per store above the market's threshold.
 */
export function DeliveryLine({ goodsMinor }: { goodsMinor: bigint }) {
  const t = useT();
  const money = useMoney();
  const { market } = useShop();
  const details = useDeliveryDetails();
  const left = useMinutesLeft(details?.cutoff ?? null);

  const flat = BigInt(market.delivery.flatFeeMinor ?? '0');
  const freeOver = market.delivery.freeOverMinor ? BigInt(market.delivery.freeOverMinor) : null;
  const free = flat === 0n || (freeOver !== null && goodsMinor >= freeOver);

  if (!details) return <div className="mt-3 h-5 w-56 max-w-full rounded skeleton" aria-hidden />;

  const p = details.promise;
  const comma = t.locale === 'ar' ? '، ' : ', ';
  const when =
    p.kind === 'days' || !details.date ? t('product.deliveryInDays')
    : p.kind === 'today' ? `${t('product.deliveryToday')}${comma}${dayLabel(details.date, t.locale)}`
    : p.kind === 'tomorrow' ? `${t('product.deliveryTomorrow')}${comma}${dayLabel(details.date, t.locale)}`
    : dayLabel(details.date, t.locale, true);
  // a countdown only while it is meaningful (the same day's cut-off)
  const showLeft = left !== null && left < 24 * 60;
  // "2 h 10 min" never breaks across lines
  const time = (left === null ? '' : left >= 60 ? t('product.hoursMinutes', { h: Math.floor(left / 60), m: left % 60 }) : t('product.minutes', { m: left })).replace(/ /g, '\u00a0');

  return (
    <div className="mt-3 text-sm leading-5" data-testid="delivery-line">
      <p className="text-ink-900">
        <span className={free ? 'text-ink-900' : 'text-ink-700'}>{free ? t('product.freeDelivery') : t('product.deliveryFee', { fee: money(flat) })}</span>{' '}
        <strong className="font-bold" data-testid="delivery-date">{when}</strong>
        {showLeft && (
          <>
            {'. '}
            <span className="text-success-600" data-testid="order-within">{t('product.orderWithin', { time })}</span>
          </>
        )}
      </p>
      {!free && freeOver !== null && (
        <p className="mt-0.5 text-[13px] text-ink-500">{t('product.freeOver', { amount: money(freeOver) })}</p>
      )}
      <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-500">
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        <span>{t('product.deliverTo', { country: t.locale === 'ar' ? market.nameAr : market.name })}</span>
      </p>
    </div>
  );
}

/** "Or pay in up to 4 interest-free payments of QAR 87.50 with PayLater" — when PayLater is on and the amount fits. */
export function PayLaterLine({ totalMinor }: { totalMinor: bigint }) {
  const t = useT();
  const money = useMoney();
  const { market } = useShop();
  if (!market.paymentMethods.includes('PAYLATER') || totalMinor < PAYLATER_MIN_MINOR || totalMinor > PAYLATER_MAX_MINOR) return null;
  const part = (totalMinor + 3n) / 4n;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-5 text-ink-700" data-testid="paylater-line">
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
      <span>{t('product.paylater', { amount: money(part) })}</span>
    </p>
  );
}
