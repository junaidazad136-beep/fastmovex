import { BadRequestException } from '@nestjs/common';
import { hasInternalKey, isTrustedInternalRead } from '../src/common/utils/internal-key';
import { OrdersService } from '../src/orders/orders.service';
import { MarketsService } from '../src/settings/countries.admin';

const KEY = 'k'.repeat(40);
const ctx = (method: string, key?: string) => ({
  getType: () => 'http',
  switchToHttp: () => ({ getRequest: () => ({ method, headers: key ? { 'x-internal-key': key } : {} }) }),
}) as never;

describe('Website server key (SSR is not rate limited per IP)', () => {
  it('only an exact key on a read-only request is trusted', () => {
    expect(isTrustedInternalRead(ctx('GET', KEY), KEY)).toBe(true);
    expect(isTrustedInternalRead(ctx('POST', KEY), KEY)).toBe(false); // never for writes
    expect(isTrustedInternalRead(ctx('GET', `${KEY}x`), KEY)).toBe(false);
    expect(isTrustedInternalRead(ctx('GET'), KEY)).toBe(false);
    expect(isTrustedInternalRead(ctx('GET', 'short'), 'short')).toBe(false); // weak keys are ignored
    expect(hasInternalKey({ headers: { 'x-internal-key': KEY } }, undefined)).toBe(false); // feature off without a key
  });
});

describe('Public market settings', () => {
  const row = {
    code: 'QA', name: 'Qatar', nameAr: 'قطر', currencyCode: 'QAR', currency: { symbol: 'QAR', minorUnits: 2 }, defaultLocale: 'en', locales: ['en', 'ar'],
    vatRateBps: 0, pricesIncludeTax: true, paymentMethods: ['CARD', 'COD'], deliveryConfig: { flatFeeMinor: '1000', freeOverMinor: '10000' },
    addressFormat: { fields: ['city'], required: ['city'] }, legalSettings: {},
  };
  const cache = { wrap: (_k: string, _t: number, fn: () => unknown) => fn() };
  it('offers only payment methods that have a working provider', async () => {
    const prisma = { country: { findMany: jest.fn().mockResolvedValue([row]) } };
    const payments = { isAvailable: (m: string) => m === 'COD', cardProvider: () => null };
    const [qa] = (await new MarketsService(prisma as never, cache as never, payments as never).list()) as { paymentMethods: string[]; delivery: unknown; currency: unknown }[];
    expect(qa.paymentMethods).toEqual(['COD']);
    expect(qa.delivery).toEqual({ flatFeeMinor: '1000', freeOverMinor: '10000', label: null });
    expect(qa.currency).toEqual({ code: 'QAR', symbol: 'QAR', minorUnits: 2 });
  });
});

describe('Customer order view: actions match the rules the API enforces', () => {
  const now = Date.now();
  const item = (over: object = {}) => ({
    id: 'i1', quantity: 3, refundedQty: 1, status: 'DELIVERED', imageKey: null, unitPriceMinor: 100n, lineTotalMinor: 300n,
    variant: { product: { slug: 'p', returnPolicyDays: null } }, returns: [{ quantity: 1 }], ...over,
  });
  const order = (sellerOrders: object[]) => ({
    orderNumber: 'FMX-QA-1', totalMinor: 1n, payments: [], history: [], sellerOrders,
  });
  const make = (o: object) => new OrdersService({ order: { findFirst: jest.fn().mockResolvedValue(o) }, refund: { findMany: jest.fn().mockResolvedValue([]) }, returnRequest: { findMany: jest.fn().mockResolvedValue([]) } } as never, { log: jest.fn() } as never, { publicUrl: () => null } as never, { postCapture: jest.fn() } as never);

  it('returnable quantity excludes refunded and in-progress returns, inside the window only', async () => {
    const delivered = new Date(now - 2 * 86_400_000);
    const view = await make(order([{ status: 'DELIVERED', deliveredAt: delivered, seller: { returnWindowDays: 7, store: { slug: 's' } }, items: [item()] }])).detailForCustomer('u', 'FMX-QA-1');
    const i = (view.sellerOrders[0].items as Record<string, unknown>[])[0];
    expect(i).toMatchObject({ returnableQty: 1, openReturnQty: 1, productSlug: 'p' }); // 3 bought − 1 refunded − 1 open
    expect(i.variant).toBeUndefined();
    expect((view as Record<string, unknown>).canCancel).toBe(false);

    const old = await make(order([{ status: 'DELIVERED', deliveredAt: new Date(now - 30 * 86_400_000), seller: { returnWindowDays: 7, store: { slug: 's' } }, items: [item()] }])).detailForCustomer('u', 'FMX-QA-1');
    expect((old.sellerOrders[0].items as Record<string, unknown>[])[0].returnableQty).toBe(0);

    const noReturns = await make(order([{ status: 'DELIVERED', deliveredAt: delivered, seller: { returnWindowDays: 7, store: { slug: 's' } }, items: [item({ variant: { product: { slug: 'p', returnPolicyDays: 0 } } })] }])).detailForCustomer('u', 'FMX-QA-1');
    expect((noReturns.sellerOrders[0].items as Record<string, unknown>[])[0]).toMatchObject({ returnableQty: 0, returnDeadline: null });
  });

  it('cancel is offered only while a shipment is pending or confirmed', async () => {
    const so = (status: string) => ({ status, deliveredAt: null, seller: { returnWindowDays: 7, store: { slug: 's' } }, items: [item({ status })] });
    expect((await make(order([so('CONFIRMED'), so('PREPARING')])).detailForCustomer('u', 'x') as Record<string, unknown>).canCancel).toBe(true);
    expect((await make(order([so('PREPARING')])).detailForCustomer('u', 'x') as Record<string, unknown>).canCancel).toBe(false);
  });

  it('customer cancel never half-cancels: a preparing shipment is left alone, not an error midway', async () => {
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue({ id: 'o', sellerOrders: [{ id: 'a', status: 'PREPARING' }] }) } };
    const svc = new OrdersService(prisma as never, { log: jest.fn() } as never, { publicUrl: () => null } as never, {} as never);
    await expect(svc.cancelByCustomer('u', 'x', 'why')).rejects.toBeInstanceOf(BadRequestException);
  });
});
