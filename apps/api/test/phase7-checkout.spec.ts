import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CheckoutService } from '../src/orders/checkout.service';
import { OrdersService } from '../src/orders/orders.service';

const QA = { code: 'QA', currencyCode: 'QAR', minorUnits: 2, vatRateBps: 0, pricesIncludeTax: true, defaultLocale: 'en', deliveryConfig: {} };
const dto = { addressId: 'addr-1', paymentMethod: 'COD' as const };

const pricedCart = {
  cart: { id: 'cart1', couponCode: null },
  canCheckout: true,
  lines: [{ row: { id: 'item1', variant: { sku: 'SKU1', product: { title: 'Phone case', images: [{ fileKey: 'k.jpg' }], category: { path: 'electronics' } } } } }],
  priced: {
    subtotalMinor: 10000n, discountMinor: 0n, deliveryFeeMinor: 1000n, taxMinor: 0n, totalMinor: 11000n, coupon: null,
    groups: [{
      sellerId: 'A', subtotalMinor: 10000n, discountMinor: 0n, deliveryFeeMinor: 1000n, taxMinor: 0n, totalMinor: 11000n,
      lines: [{ itemId: 'item1', variantId: 'v1', productId: 'p1', sellerId: 'A', quantity: 2, unitPriceMinor: 5000n, lineSubtotalMinor: 10000n, discountMinor: 0n, taxMinor: 0n, lineTotalMinor: 10000n, campaignId: null }],
    }],
  },
};

function build(over: { existingOrder?: unknown; address?: unknown; reserveCount?: number; canCheckout?: boolean } = {}) {
  const tx = {
    order: { create: jest.fn().mockResolvedValue({ id: 'order1' }) },
    sellerOrder: { create: jest.fn().mockResolvedValue({ id: 'so1' }), update: jest.fn() },
    orderItem: { create: jest.fn() },
    payment: { create: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    cartItem: { deleteMany: jest.fn() },
    cart: { update: jest.fn() },
    couponRedemption: { create: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(over.reserveCount ?? 1),
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(over.existingOrder ?? null), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'order1', orderNumber: 'FMX-QA-260922-AAA', status: 'CONFIRMED', totalMinor: 11000n, currencyCode: 'QAR', placedAt: new Date() }), update: jest.fn() },
    address: { findFirst: jest.fn().mockResolvedValue(over.address === undefined ? { id: 'addr-1', userId: 'u1', countryCode: 'QA', city: 'Doha', zone: '24' } : over.address) },
    country: { findUniqueOrThrow: jest.fn().mockResolvedValue({ paymentMethods: ['COD', 'CARD'] }) },
    cart: { findUnique: jest.fn().mockResolvedValue({ lastReminderAt: null }) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'a@b.com', phone: null }) },
    payment: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'pay1' }) },
    sellerOrder: { updateMany: jest.fn() },
    orderItem: { updateMany: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => (typeof fn === 'function' ? fn(tx) : undefined)),
  };
  const cart = {
    priceForCheckout: jest.fn().mockResolvedValue({ ...pricedCart, canCheckout: over.canCheckout ?? true }),
    view: jest.fn().mockResolvedValue({ notices: ['Some items are unavailable'] }),
  };
  const commissions = { loadRules: jest.fn().mockResolvedValue([]), compute: jest.fn().mockReturnValue({ commissionMinor: 1000n, ruleId: 'r1', snapshot: {} }) };
  const payments = { providerFor: jest.fn().mockReturnValue({ code: 'cod' }), isAvailable: jest.fn().mockReturnValue(true), assertReturnUrl: jest.fn(), start: jest.fn().mockResolvedValue({ status: 'PENDING', providerRef: 'cod_x' }) };
  const orderLedger = { postCapture: jest.fn() };
  const unpaid = { abandon: jest.fn().mockResolvedValue(true) };
  const svc = new CheckoutService(prisma as never, cart as never, commissions as never, payments as never, orderLedger as never, unpaid as never, { log: jest.fn() } as never);
  return { svc, prisma, tx, cart, payments, orderLedger, commissions, unpaid };
}

describe('Checkout', () => {
  it('same Idempotency-Key returns the SAME order, never a second one', async () => {
    const { svc, prisma, tx } = build({ existingOrder: { id: 'order1', userId: 'u1' } });
    const res = await svc.checkout('u1', QA, dto, 'key-123');
    expect(res).toMatchObject({ reused: true, orderNumber: 'FMX-QA-260922-AAA' });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to place an order when the cart has problems', async () => {
    const { svc } = build({ canCheckout: false });
    await expect(svc.checkout('u1', QA, dto, 'k')).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses an address that is not the customer's", async () => {
    const { svc } = build({ address: null });
    await expect(svc.checkout('u1', QA, dto, 'k')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a payment method that is not enabled in this market', async () => {
    const { svc, prisma } = build();
    prisma.country.findUniqueOrThrow.mockResolvedValue({ paymentMethods: ['CARD'] });
    await expect(svc.checkout('u1', QA, dto, 'k')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stock that sold out a second earlier aborts the whole order', async () => {
    const { svc, tx } = build({ reserveCount: 0 });
    await expect(svc.checkout('u1', QA, dto, 'k')).rejects.toThrow('sold out');
    expect(tx.payment.create).not.toHaveBeenCalled(); // transaction rolls back: no phantom order
  });

  it('places the order: reserves stock, splits per seller, stores commission and clears the cart', async () => {
    const { svc, tx } = build();
    await svc.checkout('u1', QA, dto, 'key-1');
    expect(tx.$executeRaw).toHaveBeenCalled(); // reservation
    expect(tx.sellerOrder.create).toHaveBeenCalledTimes(1);
    const item = tx.orderItem.create.mock.calls[0][0].data;
    expect(item).toMatchObject({ productTitle: 'Phone case', quantity: 2, commissionMinor: 1000n, commissionRuleId: 'r1' });
    // seller net = goods - discount + delivery - commission
    expect(tx.sellerOrder.update.mock.calls[0][0].data).toEqual({ commissionMinor: 1000n, sellerNetMinor: 10000n });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'cart1' } });
  });

  it('COD does not post to the ledger at checkout (no money received yet)', async () => {
    const { svc, orderLedger } = build();
    await svc.checkout('u1', QA, dto, 'k');
    expect(orderLedger.postCapture).not.toHaveBeenCalled();
  });

  it('a captured card payment posts the ledger immediately', async () => {
    const { svc, payments, orderLedger } = build();
    payments.start.mockResolvedValue({ status: 'CAPTURED', providerRef: 'test_1' });
    await svc.checkout('u1', QA, { ...dto, paymentMethod: 'CARD' }, 'k');
    expect(orderLedger.postCapture).toHaveBeenCalledWith('order1');
  });
});

describe('Orders: seller isolation', () => {
  const make = (prisma: object) => new OrdersService(prisma as never, { log: jest.fn() } as never, { publicUrl: () => null } as never, { postCapture: jest.fn() } as never);

  it("seller A cannot move seller B's shipment", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await expect(make({ sellerOrder: { findFirst } }).updateSellerOrderStatus('seller-A', 'so-of-B', 'SHIPPED', 'u')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'so-of-B', sellerId: 'seller-A' });
  });

  it("customer cannot open someone else's order", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await expect(make({ order: { findFirst } }).detailForCustomer('u1', 'FMX-QA-260922-AAA')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toEqual({ orderNumber: 'FMX-QA-260922-AAA', userId: 'u1' });
  });

  it('an already shipped order can no longer be cancelled by the customer', async () => {
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1', sellerOrders: [{ id: 'so1', status: 'SHIPPED' }] }) } };
    await expect(make(prisma).cancelByCustomer('u1', 'FMX-QA-260922-AAA', 'changed mind')).rejects.toThrow('no longer be cancelled');
  });
});
