import { BadRequestException } from '@nestjs/common';
import { buildSlotDays, localDay, localToUtc, parseSlotConfig, readSlotConfig, resolveSlot, slotLabel, SLOTS_OFF } from '../src/delivery/slots';

const QA = 180; // UTC+3
const cfg = parseSlotConfig({
  enabled: true, required: true, daysAhead: 4, leadMinutes: 120, closedWeekdays: [5], closedDates: ['2026-10-04'],
  windows: [{ start: '17:00', end: '21:00', capacity: 30 }, { start: '09:00', end: '13:00', capacity: 2 }, { start: '13:00', end: '17:00', capacity: 30 }],
});
// Thursday 1 Oct 2026, 14:30 in Doha
const now = new Date('2026-10-01T11:30:00Z');

describe('delivery slot settings', () => {
  it('sorts windows and keeps sensible defaults', () => {
    expect(cfg.windows.map((w) => w.start)).toEqual(['09:00', '13:00', '17:00']);
    expect(parseSlotConfig({})).toEqual({ ...SLOTS_OFF });
    expect(parseSlotConfig({ enabled: false, required: true }).required).toBe(false); // nothing to require when off
  });
  it('refuses settings that would break checkout', () => {
    const bad = [
      { enabled: true, windows: [] },
      { windows: [{ start: '13:00', end: '09:00', capacity: 5 }] },
      { windows: [{ start: '9:00', end: '13:00', capacity: 5 }] },
      { windows: [{ start: '09:00', end: '13:00', capacity: 0 }] },
      { windows: [{ start: '09:00', end: '13:00', capacity: 5 }, { start: '12:00', end: '15:00', capacity: 5 }] },
      { daysAhead: 0 }, { daysAhead: 30 }, { leadMinutes: -5 },
      { closedWeekdays: [0, 1, 2, 3, 4, 5, 6] }, { closedWeekdays: [7] },
      { closedDates: ['2026-13-40'] }, { closedDates: ['tomorrow'] },
      { windows: Array.from({ length: 13 }, (_, i) => ({ start: `${String(i + 8).padStart(2, '0')}:00`, end: `${String(i + 8).padStart(2, '0')}:30`, capacity: 1 })) },
    ];
    for (const b of bad) expect(() => parseSlotConfig(b)).toThrow(BadRequestException);
  });
  it('a broken stored value simply means "off" (checkout never breaks)', () => {
    expect(readSlotConfig({ enabled: true, windows: 'oops' }).enabled).toBe(false);
    expect(readSlotConfig(null)).toEqual(SLOTS_OFF);
  });
});

describe('market time', () => {
  it('converts Doha dates and times exactly', () => {
    expect(localToUtc('2026-10-03', '09:00', QA).toISOString()).toBe('2026-10-03T06:00:00.000Z');
    expect(localDay(new Date('2026-10-01T21:30:00Z'), QA)).toEqual({ date: '2026-10-02', weekday: 5 }); // 00:30 Friday in Doha
    expect(slotLabel(new Date('2026-10-03T10:00:00Z'), new Date('2026-10-03T14:00:00Z'), 'Asia/Qatar', 'en')).toBe('Sat 3 Oct, 13:00–17:00');
    expect(slotLabel(new Date('2026-10-03T10:00:00Z'), new Date('2026-10-03T14:00:00Z'), 'Asia/Qatar', 'ar')).toContain('13:00–17:00');
  });
});

describe('what the customer can pick', () => {
  const days = buildSlotDays(cfg, QA, now, new Map([[localToUtc('2026-10-03', '09:00', QA).toISOString(), 2]]));
  it('today keeps only windows that start after the lead time; Friday and the holiday are skipped', () => {
    expect(days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-03']); // Thu, (Fri closed), Sat, (Sun holiday)
    expect(days[0].slots.map((s) => s.from)).toEqual(['17:00']); // 13:00 started, 09:00 past
  });
  it('a full window is shown but cannot be picked', () => {
    const sat = days[1].slots;
    expect(sat.find((s) => s.from === '09:00')).toMatchObject({ left: 0, available: false });
    expect(sat.find((s) => s.from === '13:00')).toMatchObject({ left: 30, available: true, start: '2026-10-03T10:00:00.000Z', end: '2026-10-03T14:00:00.000Z' });
  });
  it('nothing is offered when slots are off', () => {
    expect(buildSlotDays(SLOTS_OFF, QA, now, new Map())).toEqual([]);
  });
});

describe('checking the customer\'s choice', () => {
  it('accepts a real, open window', () => {
    const r = resolveSlot(cfg, QA, now, '2026-10-03T10:00:00.000Z');
    expect(r).toEqual({ start: new Date('2026-10-03T10:00:00Z'), end: new Date('2026-10-03T14:00:00Z'), capacity: 30 });
  });
  it.each([
    ['not a date', 'SLOT_INVALID'],
    ['2026-10-03T10:30:00.000Z', 'SLOT_INVALID'], // 13:30 is not a window
    ['2026-10-02T10:00:00.000Z', 'SLOT_INVALID'], // Friday
    ['2026-10-04T10:00:00.000Z', 'SLOT_INVALID'], // holiday
    ['2026-10-09T10:00:00.000Z', 'SLOT_INVALID'], // beyond the days offered
    ['2026-09-30T10:00:00.000Z', 'SLOT_INVALID'], // yesterday
    ['2026-10-01T10:00:00.000Z', 'SLOT_CLOSED'], // today 13:00, already too late
    ['2026-10-03T10:00:00.001Z', 'SLOT_INVALID'],
  ])('refuses %s (%s)', (iso, reason) => {
    try {
      resolveSlot(cfg, QA, now, iso);
      throw new Error('should have failed');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(((e as BadRequestException).getResponse() as { reason: string }).reason).toBe(reason);
    }
  });
});
