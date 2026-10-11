'use client';

import { Clock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import type { DeliverySlots } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';

/** Loads the delivery windows (live: they fill up). `null` while loading. */
export function useDeliverySlots() {
  const [data, setData] = useState<DeliverySlots | null>(null);
  const reload = useCallback(() => {
    api<DeliverySlots>('/delivery/slots', { auth: 'none' })
      .then(setData)
      .catch(() => setData({ enabled: false, required: false, timezone: 'Asia/Qatar', days: [] }));
  }, []);
  useEffect(reload, [reload]);
  return { data, reload };
}

/** Errors the API gives for a delivery time, with what to tell the customer. */
export const SLOT_REASONS = ['SLOT_FULL', 'SLOT_REQUIRED', 'SLOT_INVALID', 'SLOT_CLOSED'] as const;

/** Day chips, then the windows of that day. Full windows stay visible but cannot be picked. */
export function SlotPicker({ data, value, onChange, invalid = false }: { data: DeliverySlots | null; value: string; onChange: (start: string) => void; invalid?: boolean }) {
  const t = useT();
  const l = t.locale;
  const intlLocale = l === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB';
  const days = data?.days ?? [];
  const chosenDay = days.find((d) => d.slots.some((s) => s.start === value))?.date;
  const [day, setDay] = useState<string | null>(null); // a date, or 'asap'
  const firstOpen = days.find((d) => d.slots.some((s) => s.available))?.date ?? days[0]?.date ?? '';
  const activeDay = chosenDay ?? (day && (day === 'asap' || days.some((d) => d.date === day)) ? day : data?.required ? firstOpen : 'asap');

  const fmt = useMemo(() => {
    const tz = data?.timezone ?? 'Asia/Qatar';
    const time = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const dayName = new Intl.DateTimeFormat(intlLocale, { timeZone: 'UTC', weekday: 'short' });
    const dayNum = new Intl.DateTimeFormat(intlLocale, { timeZone: 'UTC', day: 'numeric', month: 'short' });
    return { time: (iso: string) => time.format(new Date(iso)), dayName: (d: string) => dayName.format(new Date(`${d}T12:00:00Z`)), dayNum: (d: string) => dayNum.format(new Date(`${d}T12:00:00Z`)) };
  }, [data?.timezone, intlLocale]);

  if (!data) return <section className="card p-5" aria-busy="true"><div className="skeleton h-6 w-40" /><div className="skeleton mt-4 h-20" /></section>;
  if (!data.enabled) return null;

  const today = days[0]?.date;
  const label = (d: string, i: number) => (i === 0 && d === today && isToday(d, data.timezone) ? t('slot.today') : isTomorrow(d, data.timezone) ? t('slot.tomorrow') : fmt.dayName(d));
  const current = days.find((d) => d.date === activeDay);

  return (
    <section className={`card p-5 ${invalid ? 'ring-2 ring-danger-500' : ''}`} aria-labelledby="co-slot" data-testid="slot-picker">
      <h2 id="co-slot" className="mb-1 flex items-center gap-2 font-bold"><Clock className="size-5 text-brand-600" aria-hidden />{t('slot.title')}</h2>
      <p className="mb-4 text-sm text-ink-500">{data.required ? t('slot.pickRequired') : t('slot.pickOptional')}</p>
      {days.length === 0 ? (
        <p className="rounded-xl bg-warning-50 px-3.5 py-2.5 text-sm text-warning-600">{t('slot.none')}</p>
      ) : (
        <>
          <div className="no-scrollbar -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('slot.day')}>
            {!data.required && (
              <button type="button" role="tab" aria-selected={activeDay === 'asap'} onClick={() => { onChange(''); setDay('asap'); }}
                className={`shrink-0 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${activeDay === 'asap' ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:border-ink-300'}`} data-testid="slot-asap">
                {t('slot.asap')}
              </button>
            )}
            {days.map((d, i) => {
              const on = d.date === activeDay;
              const anyFree = d.slots.some((s) => s.available);
              return (
                <button key={d.date} type="button" role="tab" aria-selected={on} onClick={() => { if (d.date !== activeDay) onChange(''); setDay(d.date); }} disabled={!anyFree}
                  className={`shrink-0 rounded-xl border px-3.5 py-2 text-start transition disabled:opacity-45 ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:border-ink-300'}`} data-testid={`slot-day-${d.date}`}>
                  <span className="block text-sm font-semibold">{label(d.date, i)}</span>
                  <span className="block text-xs text-ink-500">{anyFree ? fmt.dayNum(d.date) : t('slot.full')}</span>
                </button>
              );
            })}
          </div>
          {current && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('slot.window')}>
              {current.slots.map((s) => {
                const on = value === s.start;
                return (
                  <li key={s.start}>
                    <label className={`flex h-full cursor-pointer flex-col rounded-xl border px-3 py-2.5 text-sm transition has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${on ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600' : 'border-ink-200 hover:border-ink-300'}`}>
                      <input type="radio" name="slot" className="sr-only" value={s.start} checked={on} disabled={!s.available} onChange={() => onChange(s.start)} data-testid="slot-window" />
                      <span className="tabular font-semibold text-ink-900" dir="ltr">{fmt.time(s.start)} – {fmt.time(s.end)}</span>
                      <span className={`text-xs ${s.available ? (s.left <= 3 ? 'text-warning-600' : 'text-ink-500') : 'text-danger-600'}`}>
                        {!s.available ? t('slot.full') : s.left <= 3 ? t.plural('slot.left', s.left) : t('slot.available')}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function localDate(offsetDays: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86_400_000));
  return parts; // en-CA gives YYYY-MM-DD
}
const isToday = (d: string, tz: string) => d === localDate(0, tz);
const isTomorrow = (d: string, tz: string) => d === localDate(1, tz);
