import { BadRequestException } from '@nestjs/common';
import { MAX_TAGS, normaliseTags } from '../src/admin/customer-notes';
import { marginPct, onTimePct } from '../src/admin/insights';
import { alertMode, cleanPrefs, STAFF_ALERT_RULES } from '../src/notifications/staff-alerts';
import { STAFF_ALERTS, TEMPLATES } from '../src/notifications/templates';

describe('Phase 21 — margin and driver maths', () => {
  it('margin % of revenue, two decimals, null without revenue', () => {
    expect(marginPct(18000n, 10000n)).toBe(55.55);
    expect(marginPct(10000n, -2500n)).toBe(-25);
    expect(marginPct(0n, 0n)).toBeNull();
  });
  it('on time % over deliveries that had a promised window', () => {
    expect(onTimePct(9, 10)).toBe(90);
    expect(onTimePct(2, 3)).toBe(66.7);
    expect(onTimePct(0, 0)).toBeNull();
  });
});

describe('Phase 21 — customer tags', () => {
  it('upper-cases, joins words with _, drops blanks and duplicates', () => {
    expect(normaliseTags(['vip', ' Wholesale ', 'VIP', '', 'big spender'])).toEqual(['VIP', 'WHOLESALE', 'BIG_SPENDER']);
  });
  it('refuses odd characters, one letter and too many tags', () => {
    expect(() => normaliseTags(['no!'])).toThrow(BadRequestException);
    expect(() => normaliseTags(['a'])).toThrow(BadRequestException);
    expect(() => normaliseTags(['x'.repeat(21)])).toThrow(BadRequestException);
    expect(() => normaliseTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `T${i}X`))).toThrow(/At most/);
  });
});

describe('Phase 21 — staff alerts', () => {
  it('every alert has a rule, a permission and texts in both languages, and never goes by SMS or WhatsApp', () => {
    for (const t of STAFF_ALERTS) {
      expect(STAFF_ALERT_RULES[t].permission).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(TEMPLATES[t].en.title).toBeTruthy();
      expect(TEMPLATES[t].ar.title).toBeTruthy();
      expect(TEMPLATES[t].sms).toBeFalsy();
      expect(TEMPLATES[t].whatsapp).toBeFalsy();
      expect(TEMPLATES[t].email).toBeFalsy(); // email only when the staff member chose it
    }
  });
  it('defaults to the bell; keeps only known alerts and modes', () => {
    expect(alertMode({}, 'STAFF_NEW_ORDER')).toBe('app');
    expect(alertMode(null, 'STAFF_NEW_ORDER')).toBe('app');
    expect(alertMode({ STAFF_NEW_ORDER: 'email' }, 'STAFF_NEW_ORDER')).toBe('email');
    expect(alertMode({ STAFF_NEW_ORDER: 'loud' }, 'STAFF_NEW_ORDER')).toBe('app');
    expect(cleanPrefs({ STAFF_LOW_STOCK: 'off', STAFF_NEW_ORDER: 'loud', OTHER: 'email' })).toEqual({ STAFF_LOW_STOCK: 'off' });
  });
});
