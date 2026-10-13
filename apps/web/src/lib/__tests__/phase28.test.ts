import { describe, expect, it } from 'vitest';
import type { DeliverySlots } from '../api/types';
import { dayLabel, detailsFrom } from '../delivery-promise';
import { paylaterFits } from '../state/checkout-cart';

const slot = (start: string, available = true) => ({ start, end: start, from: '09:00', to: '13:00', left: available ? 5 : 0, available });
const slots = (days: { date: string; slots: ReturnType<typeof slot>[] }[], leadMinutes = 120): DeliverySlots & { leadMinutes: number } =>
  ({ enabled: true, required: false, timezone: 'Asia/Qatar', leadMinutes, days: days.map((d) => ({ ...d, weekday: 0 })) });

describe('product page delivery line', () => {
  const now = new Date('2026-10-13T08:00:00Z'); // 11:00 in Doha
  it('gives the day of the first free window and the order cut-off (window start minus lead time)', () => {
    const d = detailsFrom(slots([{ date: '2026-10-13', slots: [slot('2026-10-13T11:00:00Z', false)] }, { date: '2026-10-14', slots: [slot('2026-10-14T06:00:00Z')] }]), now);
    expect(d.promise).toEqual({ kind: 'tomorrow' });
    expect(d.date).toBe('2026-10-14');
    expect(d.cutoff).toBe('2026-10-14T04:00:00.000Z');
  });
  it('same-day window: the cut-off is today; a passed cut-off shows no countdown', () => {
    expect(detailsFrom(slots([{ date: '2026-10-13', slots: [slot('2026-10-13T12:00:00Z')] }]), now)).toMatchObject({ promise: { kind: 'today' }, cutoff: '2026-10-13T10:00:00.000Z' });
    expect(detailsFrom(slots([{ date: '2026-10-13', slots: [slot('2026-10-13T09:00:00Z')] }]), now).cutoff).toBeNull();
  });
  it('without windows: "in 1–2 days", no date', () => {
    expect(detailsFrom(null, now)).toEqual({ promise: { kind: 'days' }, date: null, cutoff: null });
  });
  it('formats the day in Qatar time, in both languages', () => {
    expect(dayLabel('2026-10-14', 'en')).toBe('14 Oct');
    expect(dayLabel('2026-10-16', 'en', true)).toBe('Friday 16 Oct');
    expect(dayLabel('2026-10-14', 'ar')).toMatch(/14/);
  });
});

describe('PayLater range', () => {
  it('QAR 300 to QAR 25,000 only', () => {
    expect(paylaterFits('29999')).toBe(false);
    expect(paylaterFits('30000')).toBe(true);
    expect(paylaterFits('2500000')).toBe(true);
    expect(paylaterFits('2500001')).toBe(false);
    expect(paylaterFits(null)).toBe(false);
  });
});
