import { describe, expect, it } from 'vitest';
import { codAvailability, codErrorMessage } from '@/components/checkout/cod';
import { ApiError } from '@/lib/api/errors';
import type { Market } from '@/lib/api/types';

const market = (cod?: Market['cod']) => ({ cod } as Market);
const t = ((k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ''}`) as never;

describe('cash on delivery at checkout', () => {
  it('is offered up to the market limit, and to guests only when phones can be checked', () => {
    const m = market({ maxOrderMinor: '50000', guestPhoneCheck: true, accountPhoneCheck: false, guestAvailable: true });
    expect(codAvailability(m, '50000', false)).toEqual({ ok: true });
    expect(codAvailability(m, '50001', false)).toEqual({ ok: false, why: 'limit', maxMinor: '50000' });
    expect(codAvailability(market({ maxOrderMinor: null, guestPhoneCheck: true, accountPhoneCheck: false, guestAvailable: false }), '100', true)).toEqual({ ok: false, why: 'signIn' });
    expect(codAvailability(market({ maxOrderMinor: null, guestPhoneCheck: true, accountPhoneCheck: false, guestAvailable: false }), '100', false)).toEqual({ ok: true });
    expect(codAvailability(market(undefined), '999999999', true)).toEqual({ ok: true }); // older API: no rules sent
  });
  it('turns the API refusals into the shopper’s language', () => {
    const err = (reason: string, extra: Record<string, unknown> = {}) => new ApiError(400, { message: 'x', reason, ...extra });
    expect(codErrorMessage(err('COD_LIMIT', { maxOrderMinor: '50000' }), t, (m) => `QAR ${Number(m) / 100}`)).toBe('cod.limit{"amount":"QAR 500"}');
    expect(codErrorMessage(err('COD_BLOCKED'), t, String)).toBe('cod.blocked');
    expect(codErrorMessage(err('COD_PHONE_CODE'), t, String)).toBe('cod.codeWrong');
    expect(codErrorMessage(err('SMS_OFF'), t, String)).toBe('cod.noSms');
  });
});
