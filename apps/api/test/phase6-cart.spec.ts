import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CartService, effectiveUnitPrice, lineIssues } from '../src/cart/cart.service';
import { ConfigDeliveryQuoter } from '../src/pricing/delivery-quoter';

const QA = { code: 'QA', currencyCode: 'QAR', minorUnits: 2, vatRateBps: 0, pricesIncludeTax: true, defaultLocale: 'en', deliveryConfig: { flatFeeMinor: '1000', freeOverMinor: '10000' } };
const storage = { publicUrl: (k?: string | null) => (k ? `https://cdn/${k}` : null) };
const now = new Date();
const hour = 3_600_000;

const variant = (o: Record<string, unknown> = {}) => ({
  id: 'v1', sku: 'SKU', optionValues: {}, priceMinor: 5000n, compareAtMinor: null, isActive: true,
  inventory: { onHand: 10, reserved: 0 }, campaignProducts: [] as unknown[],
  product: {
    id: 'p1', slug: 'p', title: 'Phone case', titleAr: null, status: 'ACTIVE', deletedAt: null, countryCode: 'QA',
    category: { path: 'electronics' }, images: [],
    store: { name: 'Doha Gadgets', nameAr: null, slug: 'doha-gadgets', isActive: true, sellerId: 'A', seller: { status: 'APPROVED' } },
  },
  ...o,
});
const item = (o: Record<string, unknown> = {}) => ({ id: 'i1', quantity: 2, priceSnapshotMinor: 5000n, addedAt: now, variant: variant(), ...o });

describe('cart line rules', () => {
  it('live campaign price applies; expired or sold-out campaign does not', () => {
    const cp = (o: object) => ({ campaignId: 'c', dealPriceMinor: 3000n, stockLimit: null, soldCount: 0, campaign: { isActive: true, startsAt: new Date(now.getTime() - hour), endsAt: new Date(now.getTime() + hour), countryCode: 'QA' }, ...o });
    expect(effectiveUnitPrice({ priceMinor: 5000n, campaignProducts: [cp({})] } as never, 'QA', now)).toEqual({ unit: 3000n, campaignId: 'c' });
    expect(effectiveUnitPrice({ priceMinor: 5000n, campaignProducts: [cp({ stockLimit: 5, soldCount: 5 })] } as never, 'QA', now).unit).toBe(5000n);
    expect(effectiveUnitPrice({ priceMinor: 5000n, campaignProducts: [cp({ campaign: { isActive: true, startsAt: new Date(0), endsAt: new Date(now.getTime() - 1), countryCode: 'QA' } })] } as never, 'QA', now).unit).toBe(5000n);
    expect(effectiveUnitPrice({ priceMinor: 5000n, campaignProducts: [cp({ campaign: { isActive: true, startsAt: new Date(0), endsAt: new Date(now.getTime() + hour), countryCode: 'AE' } })] } as never, 'QA', now).unit).toBe(5000n);
  });

  it('detects price change since added', () => {
    expect(lineIssues(item({ priceSnapshotMinor: 4500n }) as never, 'QA', 5000n).issues).toEqual(['PRICE_CHANGED']);
  });
  it('out of stock / insufficient stock (reserved units excluded)', () => {
    expect(lineIssues(item({ variant: variant({ inventory: { onHand: 3, reserved: 3 } }) }) as never, 'QA', 5000n).issues).toEqual(['OUT_OF_STOCK']);
    expect(lineIssues(item({ quantity: 5, variant: variant({ inventory: { onHand: 5, reserved: 2 } }) }) as never, 'QA', 5000n)).toEqual({ issues: ['INSUFFICIENT_STOCK'], available: 3 });
  });
  it('suspended seller makes item unavailable', () => {
    const v = variant();
    (v.product.store.seller as { status: string }).status = 'SUSPENDED';
    expect(lineIssues(item({ variant: v }) as never, 'QA', 5000n).issues).toEqual(['UNAVAILABLE']);
  });
});

function mockPrisma(o: Record<string, unknown> = {}) {
  return {
    cart: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: null, guestToken: 'guest-token-123456789012345', countryCode: 'QA', currencyCode: 'QAR', couponCode: null }),
      create: jest.fn(), upsert: jest.fn(), update: jest.fn(),
    },
    cartItem: {
      findMany: jest.fn().mockResolvedValue([item()]), findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0), upsert: jest.fn(), update: jest.fn(), delete: jest.fn(),
    },
    productVariant: { findUnique: jest.fn().mockResolvedValue(variant()) },
    ...o,
  };
}
const make = (prisma: object, coupons: object = { resolve: jest.fn() }) => new CartService(prisma as never, coupons as never, new ConfigDeliveryQuoter(), storage as never);
const guest = { country: QA, guestToken: 'guest-token-123456789012345' };

describe('CartService', () => {
  it('prices from the database: 2 x 50 = 100, free delivery at 100', async () => {
    const view = await make(mockPrisma()).view(guest);
    expect(view.totals).toMatchObject({ subtotalMinor: '10000', deliveryFeeMinor: '0', totalMinor: '10000', itemCount: 2 });
    expect(view.canCheckout).toBe(true);
    expect(view.cartToken).toBe('guest-token-123456789012345');
  });

  it('price change blocks checkout until acknowledged', async () => {
    const p = mockPrisma();
    p.cartItem.findMany.mockResolvedValue([item({ priceSnapshotMinor: 4000n })]);
    const view = await make(p).view(guest);
    expect(view.canCheckout).toBe(false);
    expect(view.groups[0].items[0]).toMatchObject({ priceChangedFromMinor: '4000', unitPriceMinor: '5000' });
  });

  it('out-of-stock line is excluded from totals and blocks checkout', async () => {
    const p = mockPrisma();
    p.cartItem.findMany.mockResolvedValue([item({ variant: variant({ inventory: { onHand: 0, reserved: 0 } }) })]);
    const view = await make(p).view(guest);
    expect(view.totals.totalMinor).toBe('0');
    expect(view.canCheckout).toBe(false);
  });

  it('cannot add more than available stock', async () => {
    const p = mockPrisma({ productVariant: { findUnique: jest.fn().mockResolvedValue(variant({ inventory: { onHand: 3, reserved: 1 } })) } });
    await expect(make(p).addItem(guest, 'v1', 3)).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot add a product from another market', async () => {
    const v = variant();
    v.product.countryCode = 'AE';
    const p = mockPrisma({ productVariant: { findUnique: jest.fn().mockResolvedValue(v) } });
    await expect(make(p).addItem(guest, 'v1', 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('snapshot price stored on add comes from DB (deal price if live)', async () => {
    const p = mockPrisma();
    await make(p).addItem(guest, 'v1', 1);
    expect(p.cartItem.upsert.mock.calls[0][0].create.priceSnapshotMinor).toBe(5000n);
  });

  it("guest token cannot open a logged-in user's cart", async () => {
    const p = mockPrisma();
    p.cart.findUnique.mockResolvedValue({ id: 'c', userId: 'someone', guestToken: 'guest-token-123456789012345', countryCode: 'QA', currencyCode: 'QAR', couponCode: null });
    const view = await make(p).view(guest);
    expect(view.groups).toEqual([]);
  });

  it("updating an item that is not in the caller's cart -> 404", async () => {
    const p = mockPrisma();
    p.cartItem.findFirst.mockResolvedValue(null);
    await expect(make(p).updateItem(guest, 'someone-elses-item', 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(p.cartItem.findFirst.mock.calls[0][0].where).toEqual({ id: 'someone-elses-item', cartId: 'cart1' });
  });

  it('coupons need login', async () => {
    await expect(make(mockPrisma()).applyCoupon(guest, 'SAVE10')).rejects.toThrow('Log in');
  });

  it('invalid coupon is reported, not silently applied', async () => {
    const p = mockPrisma();
    p.cart.findUnique.mockResolvedValue({ id: 'cart1', userId: 'u', guestToken: null, countryCode: 'QA', currencyCode: 'QAR', couponCode: 'OLD' });
    const coupons = { resolve: jest.fn().mockResolvedValue({ error: 'EXPIRED' }) };
    const view = await make(p, coupons).view({ country: QA, userId: 'u' });
    expect(view.coupon).toEqual({ code: 'OLD', applied: false, message: 'This code has expired', reason: 'EXPIRED' }); // reason: stable code the apps translate
    expect(view.totals.discountMinor).toBe('0');
  });
});
