import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { base32Decode, base32Encode, deviceLabel, hashRecoveryCode, hotp, newRecoveryCodes, otpauthUrl, totp, verifyTotp } from '../src/auth/totp';
import { isStaffUser, staffTwoFactorRequired, TwoFactorGuard } from '../src/common/guards/two-factor.guard';
import { distanceMetres, failureKind, FAR_FROM_ADDRESS_M } from '../src/delivery/delivery-rules';
import { renderDailyClosing } from '../src/documents/daily-closing';
import { renderPurchaseOrder } from '../src/documents/purchase-order';
import { dohaToday } from '../src/inventory/stock-control';
import { assertReasonDirection, assertWriteOffAllowed } from '../src/inventory/write-off';
import { amountToMinor, dayBounds, parseCsv, readSettlement } from '../src/payments/reconciliation';
import { weightedCost } from '../src/purchasing/purchasing';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('two-step sign-in codes (RFC 4226 / 6238)', () => {
  it('base32 round-trips and ignores spaces, dashes and case', () => {
    const b = Buffer.from('hello world, FastMoveX');
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(base32Decode(base32Encode(b).toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(b);
    expect(() => base32Decode('0189')).toThrow('Invalid base32');
  });
  it('HOTP matches the RFC 4226 test values', () => {
    const key = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 3, 9].map((c) => hotp(key, c))).toEqual(['755224', '287082', '359152', '969429', '520489']);
  });
  it('TOTP matches the RFC 6238 test values (last 6 digits)', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });
  it('accepts one step of clock drift either way, nothing more, and never the same step twice', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now, step)).toBeNull(); // replay
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });
  it('recovery codes: 10 unique XXXX-XXXX codes, hashed without dashes or case mattering', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(hashRecoveryCode('abcd-efgh', 'p')).toBe(hashRecoveryCode('ABCDEFGH', 'p'));
    expect(hashRecoveryCode('ABCDEFGH', 'p')).not.toBe(hashRecoveryCode('ABCDEFGH', 'q'));
  });
  it('builds the otpauth link the authenticator app scans', () => {
    expect(otpauthUrl('ABC', 'ops@fastmovex.qa')).toBe('otpauth://totp/FastMoveX%3Aops%40fastmovex.qa?secret=ABC&issuer=FastMoveX&algorithm=SHA1&digits=6&period=30');
  });
  it('names devices in plain words', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge on Windows');
    expect(deviceLabel(undefined)).toBe('Unknown device');
  });
  it('only staff need it: customers, sellers and drivers do not', () => {
    expect(isStaffUser({ permissions: ['orders.read'] })).toBe(true);
    expect(isStaffUser({ permissions: [] })).toBe(false);
    expect(isStaffUser({ permissions: ['delivery.update_own'] })).toBe(false);
  });
});

describe('two-step sign-in enforcement', () => {
  const config = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as never;
  const ctx = (user: object | undefined) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => null, getClass: () => null }) as never;
  const reflector = (allowed: boolean) => ({ getAllAndOverride: () => allowed }) as never;
  it('required in production unless switched off, optional elsewhere unless switched on', () => {
    expect(staffTwoFactorRequired(config({ NODE_ENV: 'production' }))).toBe(true);
    expect(staffTwoFactorRequired(config({ NODE_ENV: 'production', STAFF_TWO_FACTOR: 'optional' }))).toBe(false);
    expect(staffTwoFactorRequired(config({ NODE_ENV: 'development' }))).toBe(false);
    expect(staffTwoFactorRequired(config({ NODE_ENV: 'development', STAFF_TWO_FACTOR: 'required' }))).toBe(true);
  });
  it('a staff session without the code can only reach the set-up routes', () => {
    const on = config({ NODE_ENV: 'production' });
    const staffUser = { permissions: ['orders.read'], mfa: false };
    expect(() => new TwoFactorGuard(reflector(false), on).canActivate(ctx(staffUser))).toThrow(ForbiddenException);
    expect(new TwoFactorGuard(reflector(true), on).canActivate(ctx(staffUser))).toBe(true);
    expect(new TwoFactorGuard(reflector(false), on).canActivate(ctx({ ...staffUser, mfa: true }))).toBe(true);
    expect(new TwoFactorGuard(reflector(false), on).canActivate(ctx({ permissions: [], mfa: false }))).toBe(true); // customer
    expect(new TwoFactorGuard(reflector(false), on).canActivate(ctx({ permissions: ['delivery.update_own'], mfa: false }))).toBe(true); // driver
    expect(new TwoFactorGuard(reflector(false), on).canActivate(ctx(undefined))).toBe(true); // public route
    expect(new TwoFactorGuard(reflector(false), config({ NODE_ENV: 'development' })).canActivate(ctx(staffUser))).toBe(true);
  });
});

describe('failed delivery proof', () => {
  it('measures how far the driver was from the pin', () => {
    expect(distanceMetres({ lat: 25.2854, lng: 51.531 }, { lat: 25.2854, lng: 51.531 })).toBe(0);
    const d = distanceMetres({ lat: 25.304, lng: 51.531 }, { lat: 25.322, lng: 51.531 });
    expect(d).toBeGreaterThan(1950);
    expect(d).toBeLessThan(2050);
    expect(FAR_FROM_ADDRESS_M).toBe(500);
  });
  it('turns the driver’s reason into what the customer is told', () => {
    expect(failureKind('Customer not answering')).toBe('NO_ANSWER');
    expect(failureKind('Customer not at home')).toBe('NOT_HOME');
    expect(failureKind('Wrong or incomplete address')).toBe('ADDRESS');
    expect(failureKind('Customer asked for another day')).toBe('ANOTHER_DAY');
    expect(failureKind('Customer refused the order')).toBe('REFUSED');
    expect(failureKind('Car broke down')).toBe('OTHER');
    expect(failureKind(null)).toBeNull();
  });
});

describe('stock write-offs', () => {
  it('reasons go one way: damaged/expired/lost only remove, restock/found only add', () => {
    expect(() => assertReasonDirection('DAMAGED', 2)).toThrow(BadRequestException);
    expect(() => assertReasonDirection('FOUND', -1)).toThrow(BadRequestException);
    expect(() => assertReasonDirection('RESTOCK', -1)).toThrow(BadRequestException);
    expect(() => assertReasonDirection('LOST', -3)).not.toThrow();
    expect(() => assertReasonDirection('ADJUSTMENT', -3)).not.toThrow();
    expect(() => assertReasonDirection('ADJUSTMENT', 3)).not.toThrow();
  });
  it('removing more than QAR 500 at cost needs a manager; adding never does', async () => {
    const prisma = { productVariant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sku: 'OUD-1', priceMinor: 30000n, costPriceMinor: 20000n, product: { country: { currencyCode: 'QAR' } } }) } };
    const clerk = { permissions: ['inventory.manage'] };
    await expect(assertWriteOffAllowed(prisma as never, clerk, 'v', -2)).resolves.toBeUndefined(); // 400.00
    await expect(assertWriteOffAllowed(prisma as never, clerk, 'v', -3)).rejects.toThrow(ForbiddenException); // 600.00
    await expect(assertWriteOffAllowed(prisma as never, { permissions: ['inventory.manage', 'inventory.approve'] }, 'v', -30)).resolves.toBeUndefined();
    await expect(assertWriteOffAllowed(prisma as never, clerk, 'v', 50)).resolves.toBeUndefined();
  });
  it('"today" for expiry is the Qatar date', () => {
    expect(dohaToday(new Date('2026-10-04T20:59:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(dohaToday(new Date('2026-10-04T21:01:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('purchasing', () => {
  it('average cost: weighted by units, the first delivery sets it', () => {
    expect(weightedCost(0, null, 10, 1000n)).toBe(1000n);
    expect(weightedCost(5, null, 10, 1000n)).toBe(1000n);
    expect(weightedCost(10, 1000n, 10, 2000n)).toBe(1500n);
    expect(weightedCost(3, 1000n, 1, 2000n)).toBe(1250n);
    expect(weightedCost(2, 1000n, 1, 1001n)).toBe(1000n); // rounded to the nearest minor unit
  });
  it('prints a purchase order PDF with Arabic product names', async () => {
    const pdf = await renderPurchaseOrder({
      number: 'PO-QA-261005-AB12', status: 'ORDERED', createdAt: new Date(), orderedAt: new Date(), expectedOn: '2026-10-20', tz: 'Asia/Qatar', currencyCode: 'QAR',
      supplier: { name: 'Gulf Dates Trading', contactName: 'Ahmed', phone: '+974 4444 1234', email: null, crNumber: '12345', address: 'Industrial Area, St 24', paymentTerms: '30 days' },
      warehouse: { name: 'Main warehouse', code: 'MAIN', address: null, city: 'Doha' }, note: 'Deliver before 10 am', raisedBy: 'Demo Admin',
      lines: [{ sku: 'KH-1', barcode: '6291000000001', title: 'تمر خلاص فاخر 1 كغ', quantity: 12, receivedQty: 0, unitCostMinor: 3550n }],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('payments reconciliation', () => {
  it('reads CSV with quotes, commas or semicolons and a BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\r\n\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
    expect(parseCsv('ref;amount\nA;1,50')).toEqual([['ref', 'amount'], ['A', '1,50']]);
  });
  it('turns amounts into minor units without floating point', () => {
    expect(amountToMinor('1,234.50')).toBe(123450n);
    expect(amountToMinor('99')).toBe(9900n);
    expect(amountToMinor('QAR 12.5')).toBe(1250n);
    expect(amountToMinor('-20.00')).toBe(-2000n);
    expect(amountToMinor('0.1')).toBe(10n);
    expect(amountToMinor('1.505')).toBeNull();
    expect(amountToMinor('abc')).toBeNull();
  });
  it('finds the columns by name, or uses the first two; bad rows are listed, not fatal', () => {
    const r = readSettlement('Date,Payment ID,Amount\n2026-10-04,tr_1,10.00\n2026-10-04,,5\n2026-10-04,tr_2,x');
    expect(r.rows).toEqual([{ line: 2, reference: 'tr_1', amountMinor: 1000n, date: new Date('2026-10-04') }]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(readSettlement('tr_9,1.00').rows[0]).toMatchObject({ reference: 'tr_9', amountMinor: 100n, date: null });
    expect(() => readSettlement('reference,fee\nx,1')).toThrow('"amount" column');
    expect(() => readSettlement('')).toThrow('empty');
  });
  it('a closing day runs midnight to midnight in Qatar', () => {
    expect(dayBounds('2026-10-05', 180)).toEqual({ from: new Date('2026-10-04T21:00:00Z'), to: new Date('2026-10-05T21:00:00Z') });
  });
  it('prints the daily closing PDF', async () => {
    const pdf = await renderDailyClosing({
      date: '2026-10-05', tz: 'Asia/Qatar', currencyCode: 'QAR', generatedAt: new Date(), netMinor: '120000',
      sales: { byMethod: [{ method: 'COD', orders: 3, totalMinor: '45000' }, { method: 'CARD', orders: 2, totalMinor: '80000' }], orders: 5, totalMinor: '125000', cancelledOrders: 1, cancelledMinor: '9000' },
      cardCaptured: { byMethod: [{ method: 'CARD', payments: 2, totalMinor: '80000' }], totalMinor: '80000' },
      refunds: { byMethod: [{ method: 'CARD', refunds: 1, totalMinor: '5000' }], totalMinor: '5000' },
      cash: {
        collectedMinor: '45000', collections: 3, handedOverExpectedMinor: '30000', handedOverReceivedMinor: '29500', varianceMinor: '-500', stillWithDriversMinor: '15000', stillWithDriversCount: 1,
        handovers: [{ number: 'CH-QA-261005-ABC123', expectedMinor: '30000', receivedMinor: '29500', varianceMinor: '-500', note: 'خمسة ريال ناقصة', createdAt: new Date(), holder: { fullName: 'Khalid' }, receivedBy: { fullName: 'Finance' } }],
      },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
