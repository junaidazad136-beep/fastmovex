import { describe, expect, it } from 'vitest';
import { promiseFrom, qatarDay } from '../delivery-promise';
import type { DeliverySlots } from '../api/types';

const slot = (available: boolean) => ({ start: '', end: '', from: '09:00', to: '13:00', left: available ? 5 : 0, available });
const slots = (days: [string, boolean][]): DeliverySlots => ({ enabled: true, required: false, timezone: 'Asia/Qatar', days: days.map(([date, ok]) => ({ date, weekday: 0, slots: [slot(ok)] })) });

describe('delivery promise on product cards', () => {
  const now = new Date('2026-10-08T19:00:00Z'); // 22:00 in Doha, 8 October
  it('uses the Qatar calendar day', () => {
    expect(qatarDay(now)).toBe('2026-10-08');
    expect(qatarDay(new Date('2026-10-08T21:30:00Z'))).toBe('2026-10-09'); // after midnight in Doha
    expect(qatarDay(now, 1)).toBe('2026-10-09');
  });
  it('the first day with a free window decides: today, tomorrow or a date', () => {
    expect(promiseFrom(slots([['2026-10-08', true]]), now)).toEqual({ kind: 'today' });
    expect(promiseFrom(slots([['2026-10-08', false], ['2026-10-09', true]]), now)).toEqual({ kind: 'tomorrow' });
    expect(promiseFrom(slots([['2026-10-09', false], ['2026-10-11', true]]), now)).toEqual({ kind: 'date', date: '2026-10-11' });
  });
  it('without delivery windows (or all full) the market promise is 1–2 days', () => {
    expect(promiseFrom({ enabled: false, required: false, timezone: 'Asia/Qatar', days: [] }, now)).toEqual({ kind: 'days' });
    expect(promiseFrom(slots([['2026-10-08', false]]), now)).toEqual({ kind: 'days' });
    expect(promiseFrom(null, now)).toEqual({ kind: 'days' });
  });
});
