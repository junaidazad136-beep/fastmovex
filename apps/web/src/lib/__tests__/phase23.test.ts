import { describe, expect, it } from 'vitest';
import en from '../i18n/messages/en';
import ar from '../i18n/messages/ar';
import { createTranslator } from '../i18n/translate';
import { keyBytes } from '../push';
import { appleName } from '../social';

describe('phase 23 helpers', () => {
  it('turns the VAPID public key (base64url) into the 65 bytes PushManager expects', () => {
    const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
    const b = keyBytes(key);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(4); // uncompressed P-256 point
  });
  it('takes Apple’s one-time name when it is there', () => {
    expect(appleName({ name: { firstName: 'Mona', lastName: 'Al-Thani' } })).toBe('Mona Al-Thani');
    expect(appleName({ name: { firstName: 'M' } })).toBeUndefined();
    expect(appleName(undefined)).toBeUndefined();
  });
  it('arrival texts: the next stop is said in words, in both languages', () => {
    const e = createTranslator('en', en);
    const a = createTranslator('ar', ar);
    expect(e.plural('order.arrival.stops', 0)).toBe('You are the next stop');
    expect(e.plural('order.arrival.stops', 2)).toBe('2 stops before yours');
    expect(a.plural('order.arrival.stops', 0)).toBe('أنت التوقف التالي');
    expect(e.plural('order.buyAgainDone', 1)).toBe('1 item added to your cart');
    expect(e('order.change.kind.ADDED')).toBe('Items added');
  });
});
