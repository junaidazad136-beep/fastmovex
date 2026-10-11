import { BadRequestException } from '@nestjs/common';
import { localDayStart } from '../src/cash/cash';
import { CodGuardService, DEFAULT_COD_RULES, parseCodRules, readCodRules } from '../src/cash/cod-rules';
import { renderCashReceipt } from '../src/documents/cash-receipt';
import { normaliseDigits, visualRuns } from '../src/documents/pdf';
import { addressText, renderRunSheet } from '../src/documents/run-sheet';
import { customerDelivery, staffDelivery } from '../src/orders/orders.service';

describe('cash-on-delivery rules', () => {
  it('defaults: guests prove their phone, two refusals switch COD off, no amount limits', () => {
    expect(parseCodRules({})).toEqual(DEFAULT_COD_RULES);
    expect(DEFAULT_COD_RULES).toMatchObject({ phoneCheck: 'GUESTS', refusalLimit: 2, maxOrderMinor: null, driverCashLimitMinor: null });
  });
  it('validates what staff send and keeps "empty" as no limit', () => {
    expect(parseCodRules({ phoneCheck: 'ALL', maxOrderMinor: '150000', maxOpenOrders: 3, refusalLimit: '', driverCashLimitMinor: null }))
      .toEqual({ phoneCheck: 'ALL', maxOrderMinor: '150000', maxOpenOrders: 3, refusalLimit: null, driverCashLimitMinor: null });
    expect(() => parseCodRules({ phoneCheck: 'SOMETIMES' })).toThrow(BadRequestException);
    expect(() => parseCodRules({ maxOrderMinor: '-5' })).toThrow('positive amount');
    expect(() => parseCodRules({ maxOrderMinor: '0' })).toThrow('positive amount');
    expect(() => parseCodRules({ maxOpenOrders: 0 })).toThrow('between 1 and 50');
    expect(() => parseCodRules({ refusalLimit: 2.5 })).toThrow('between 1 and 20');
  });
  it('a bad stored value never breaks checkout: it falls back to the defaults', () => {
    expect(readCodRules({ phoneCheck: 'nonsense' })).toEqual(DEFAULT_COD_RULES);
    expect(readCodRules(null)).toEqual(DEFAULT_COD_RULES);
  });
});

describe('COD checks at checkout', () => {
  const build = (o: { rules?: object; user?: object; blockedPhones?: number; open?: number } = {}) => {
    const prisma = {
      country: { findUnique: jest.fn().mockResolvedValue({ codRules: o.rules ?? {} }) },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ codBlocked: false, phone: null, phoneVerifiedAt: null, ...o.user }), count: jest.fn().mockResolvedValue(o.blockedPhones ?? 0) },
      order: { count: jest.fn().mockResolvedValue(o.open ?? 0) },
    };
    return { svc: new CodGuardService(prisma as never, { log: jest.fn() } as never), prisma };
  };
  const input = { userId: 'u1', countryCode: 'QA', currencyCode: 'QAR', totalMinor: 25000n, phone: '+974 5555 1234', isGuest: false };

  it('blocked customer, or a blocked customer’s phone on another account', async () => {
    await expect(build({ user: { codBlocked: true } }).svc.assertAllowed(input)).rejects.toMatchObject({ response: { reason: 'COD_BLOCKED' } });
    const phone = build({ blockedPhones: 1 });
    await expect(phone.svc.assertAllowed(input)).rejects.toMatchObject({ response: { reason: 'COD_BLOCKED' } });
    expect(phone.prisma.user.count).toHaveBeenCalledWith({ where: { phone: '+97455551234', codBlocked: true } }); // spaces ignored
  });
  it('order size and open orders', async () => {
    await expect(build({ rules: { maxOrderMinor: '20000' } }).svc.assertAllowed(input)).rejects.toMatchObject({ response: { reason: 'COD_LIMIT', message: expect.stringContaining('QAR 200.00') } });
    await expect(build({ rules: { maxOrderMinor: '25000' } }).svc.assertAllowed(input)).resolves.toBeUndefined(); // up to and including
    await expect(build({ rules: { maxOpenOrders: 2 }, open: 2 }).svc.assertAllowed(input)).rejects.toMatchObject({ response: { reason: 'COD_OPEN_ORDERS' } });
    await expect(build({ rules: { maxOpenOrders: 2 }, open: 1 }).svc.assertAllowed(input)).resolves.toBeUndefined();
  });
  it('"ALL": registered customers need a verified mobile; guests are checked at guest checkout', async () => {
    await expect(build({ rules: { phoneCheck: 'ALL' } }).svc.assertAllowed(input)).rejects.toMatchObject({ response: { reason: 'COD_PHONE_UNVERIFIED' } });
    await expect(build({ rules: { phoneCheck: 'ALL' }, user: { phone: '+97455551234', phoneVerifiedAt: new Date() } }).svc.assertAllowed(input)).resolves.toBeUndefined();
    await expect(build({ rules: { phoneCheck: 'ALL' } }).svc.assertAllowed({ ...input, isGuest: true })).resolves.toBeUndefined();
    await expect(build({ rules: { phoneCheck: 'GUESTS' } }).svc.assertAllowed(input)).resolves.toBeUndefined();
  });
});

describe('who sees the delivery code', () => {
  const d = { method: 'JOVIA', status: 'OUT_FOR_DELIVERY', trackingUrl: null, etaAt: null, courierName: 'Khalid Al Marri', deliveryCode: '4821', lastLat: 25.3, lastLng: 51.5 };
  it('the customer: the code until delivered, the driver’s first name, and where the driver is while on the way', () => {
    expect(customerDelivery(d)).toMatchObject({ deliveryCode: '4821', courierName: 'Khalid', location: { lat: 25.3, lng: 51.5, mapUrl: expect.stringContaining('25.3,51.5') } });
    expect(customerDelivery({ ...d, status: 'DELIVERED' })).toMatchObject({ deliveryCode: null, location: null });
    expect(customerDelivery({ ...d, method: 'SELLER' }).deliveryCode).toBeNull();
    expect(customerDelivery({ ...d, status: 'ASSIGNED' }).location).toBeNull();
  });
  it('staff and sellers: never the code, only whether there is one', () => {
    const out = staffDelivery(d)!;
    expect(out).not.toHaveProperty('deliveryCode');
    expect(out.hasCode).toBe(true);
    expect(staffDelivery(null)).toBeNull();
  });
});

describe('printing Arabic and English', () => {
  it('Arabic-Indic digits print as 0-9', () => {
    expect(normaliseDigits('شارع ٩٠١ مبنى ۱۲')).toBe('شارع 901 مبنى 12');
  });
  it('plain English stays one run', () => {
    expect(visualRuns('Bldg 12, St 901')).toEqual([{ text: 'Bldg 12, St 901', rtl: false }]);
  });
  it('an Arabic name: words in right-to-left order, each word in logical order for the font engine, spaces kept', () => {
    expect(visualRuns('مريم الكبيسي').map((r) => r.text)).toEqual(['الكبيسي', ' ', 'مريم']);
  });
  it('mixed: an English line with an Arabic word keeps the English order', () => {
    const runs = visualRuns('Call Noora نورة now');
    expect(runs[0].text.startsWith('Call Noora')).toBe(true);
    expect(runs.some((r) => r.text === 'نورة' && r.rtl)).toBe(true);
    expect(runs.at(-1)!.text.endsWith('now')).toBe(true);
  });
  it('address line for the run sheet', () => {
    expect(addressText({ zone: '25', street: '901', building: '12', unit: 'Flat 4', city: 'Doha', line1: null })).toBe('Flat 4, Bldg 12, St 901, Zone 25, Doha');
  });
});

describe('documents', () => {
  it('run sheet and cash receipt render as PDFs (with Arabic names)', async () => {
    const sheet = await renderRunSheet({
      driver: { fullName: 'Khalid Courier', phone: '+97450000201' }, date: new Date('2026-10-04T08:00:00Z'), tz: 'Asia/Qatar', currencyCode: 'QAR', printedBy: 'Demo Ops',
      jobs: [
        { orderNumber: 'FMX-QA-261004-AAAAAA', status: 'ASSIGNED', slot: { start: '2026-10-04T06:00:00Z', end: '2026-10-04T09:00:00Z' }, customer: { name: 'مريم الكبيسي', phone: '+97455500025' }, address: { zone: '25', street: '901', building: '12', unit: 'شقة 4', city: 'Doha', line1: null }, note: 'اتصل قبل الوصول', items: [{ title: 'Premium Khalas Dates', quantity: 2 }], pickup: { name: 'Main warehouse', place: 'Doha' }, cash: { amountMinor: '13000', currencyCode: 'QAR' } },
        { orderNumber: 'FMX-QA-261004-BBBBBB', status: 'DELIVERED', slot: null, customer: { name: 'Hessa', phone: null }, address: { zone: '70', street: null, building: null, unit: null, city: 'Doha', line1: null }, note: null, items: [], pickup: { name: null, place: null }, cash: null },
      ],
    });
    expect(sheet.subarray(0, 5).toString()).toBe('%PDF-');
    const receipt = await renderCashReceipt({
      number: 'CH-QA-261004-ABC123', createdAt: new Date(), tz: 'Asia/Qatar', currencyCode: 'QAR', holder: { fullName: 'خالد', phone: null }, receivedBy: { fullName: 'Demo Finance' },
      expectedMinor: 26000n, receivedMinor: 25000n, varianceMinor: -1000n, note: 'Short 10', orders: [{ orderNumber: 'FMX-1', collectedAt: new Date(), amountMinor: 26000n }],
    });
    expect(receipt.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('today in Doha', () => {
  it('starts at local midnight (UTC+3)', () => {
    expect(localDayStart(new Date('2026-10-04T22:30:00Z'), 180).toISOString()).toBe('2026-10-04T21:00:00.000Z'); // 01:30 Doha on the 5th
    expect(localDayStart(new Date('2026-10-04T20:30:00Z'), 180).toISOString()).toBe('2026-10-03T21:00:00.000Z'); // 23:30 Doha on the 4th
  });
});
