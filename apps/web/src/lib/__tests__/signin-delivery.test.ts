import { describe, expect, it } from 'vitest';
import { rescheduleBody } from '@/components/account/MissedDelivery';
import { normalizeOtp, RECOVERY_CODE } from '@/components/auth/fields';
import { ApiError } from '@/lib/api/errors';
import { errorMessage, lockedMessage } from '@/lib/errors';
import ar from '../i18n/messages/ar';
import en from '../i18n/messages/en';
import { createTranslator } from '../i18n/translate';

const te = createTranslator('en', en);
const ta = createTranslator('ar', ar as unknown as typeof en);

describe('two-step sign-in codes', () => {
  it('keeps only the 6 digits of an authenticator code, Arabic-Indic digits included', () => {
    expect(normalizeOtp(' 123 456 ')).toBe('123456');
    expect(normalizeOtp('١٢٣٤٥٦')).toBe('123456');
    expect(normalizeOtp('1234567')).toBe('123456');
  });
  it('upper-cases recovery codes and accepts them with or without the dash', () => {
    expect(normalizeOtp(' k7qm-2xpa ', true)).toBe('K7QM-2XPA');
    expect(RECOVERY_CODE.test('K7QM-2XPA')).toBe(true);
    expect(RECOVERY_CODE.test('K7QM2XPA')).toBe(true);
    expect(RECOVERY_CODE.test('123456')).toBe(false);
  });
});

describe('locked account', () => {
  const locked = (retryAfterSeconds?: number) =>
    new ApiError(429, { message: 'Too many wrong attempts. Signing in to this account is paused for 14 more minutes, or reset your password.', reason: 'ACCOUNT_LOCKED', retryAfterSeconds });

  it('says for how many minutes, in both languages', () => {
    expect(errorMessage(locked(840), te)).toContain('paused for 14 minutes');
    expect(errorMessage(locked(30), te)).toContain('paused for 1 minute ');
    expect(errorMessage(locked(120), ta)).toContain('دقيقتين');
    expect(errorMessage(locked(600), ta)).toContain('10 دقائق');
  });
  it('falls back to the API explanation, and plain rate limits keep the generic text', () => {
    expect(lockedMessage(locked(), te)).toContain('paused for 14 more minutes');
    expect(errorMessage(new ApiError(429, { message: 'ThrottlerException: Too Many Requests' }), te)).toBe(te('errors.tooMany'));
  });
});

describe('rearranging a missed delivery', () => {
  it('sends a window and/or a trimmed note, and nothing when both are empty', () => {
    expect(rescheduleBody('', '   ')).toBeNull();
    expect(rescheduleBody('2026-10-06T05:00:00.000Z', '')).toEqual({ deliverySlot: '2026-10-06T05:00:00.000Z' });
    expect(rescheduleBody('', ' After 5 pm, call first ')).toEqual({ note: 'After 5 pm, call first' });
    expect(rescheduleBody('2026-10-06T05:00:00.000Z', 'x'.repeat(400))?.note).toHaveLength(300);
  });
  it('has a friendly reason for every kind of missed delivery', () => {
    for (const kind of ['NO_ANSWER', 'NOT_HOME', 'ADDRESS', 'ANOTHER_DAY', 'REFUSED', 'OTHER'] as const) {
      expect(te(`order.missed.kind.${kind}`)).not.toContain('order.missed');
      expect(ta(`order.missed.kind.${kind}`)).not.toContain('order.missed');
    }
  });
});
