import { judge, overall, type HealthMetric } from '../src/sellers/health';
import { isAway, storeOpen } from '../src/stores/away';

describe('Phase 33 — Account Health', () => {
  it('a share is good up to the target, a warning up to the limit, bad beyond; too few orders are not judged', () => {
    expect(judge(0.02, 100, 10, 0.025, 0.05)).toBe('good');
    expect(judge(0.04, 100, 10, 0.025, 0.05)).toBe('warn');
    expect(judge(0.2, 100, 10, 0.025, 0.05)).toBe('bad');
    expect(judge(0.5, 4, 10, 0.025, 0.05)).toBe('none');
    expect(judge(null, 0, 10, 0.025, 0.05)).toBe('none');
  });
  it('ratings and answered questions: higher is better', () => {
    expect(judge(4.6, 20, 5, 4, 3.5, true)).toBe('good');
    expect(judge(3.7, 20, 5, 4, 3.5, true)).toBe('warn');
    expect(judge(3.1, 20, 5, 4, 3.5, true)).toBe('bad');
  });
  it('the store is poor with any bad measure, at risk with any warning', () => {
    const m = (state: HealthMetric['state']) => ({ state }) as HealthMetric;
    expect(overall([m('good'), m('none')])).toBe('good');
    expect(overall([m('good'), m('warn')])).toBe('risk');
    expect(overall([m('warn'), m('bad')])).toBe('poor');
  });
});

describe('Phase 33 — vacation mode', () => {
  it('away only while the date is in the future; it reopens by itself', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(isAway(new Date('2026-10-15T00:00:00Z'), now)).toBe(true);
    expect(isAway(new Date('2026-10-14T11:59:00Z'), now)).toBe(false);
    expect(isAway(null, now)).toBe(false);
    expect(storeOpen(now)).toEqual({ OR: [{ awayUntil: null }, { awayUntil: { lte: now } }] });
  });
});
