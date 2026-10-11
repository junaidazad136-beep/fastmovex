import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { UnpaidOrdersService } from '../src/orders/unpaid-orders.service';
import { PaymentsService } from '../src/payments/payments.service';
import { TestPaymentProvider } from '../src/payments/providers/test.provider';
import { CountriesAdminService } from '../src/settings/countries.admin';
import { MemoryCacheService } from '../src/cache/cache.service';

const audit = { log: jest.fn() };

describe('UnpaidOrdersService', () => {
  it('only acts on orders that are still PENDING (webhook and expiry job cannot both act)', async () => {
    const tx = { order: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    await expect(new UnpaidOrdersService(prisma as never, audit as never).abandon('o1', 'test')).resolves.toBe(false);
  });

  it('returns stock, deal quota and coupon use, and restores the cart', async () => {
    const tx = {
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          userId: 'u', countryCode: 'QA', currencyCode: 'QAR', couponId: 'c1', coupon: { code: 'WELCOME10' }, user: { isGuest: false },
          items: [{ id: 'i1', variantId: 'v1', quantity: 2, unitPriceMinor: 5000n, campaignId: 'camp' }],
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      inventoryMovement: { create: jest.fn() },
      couponRedemption: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      sellerOrder: { updateMany: jest.fn() }, orderItem: { updateMany: jest.fn() }, payment: { updateMany: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'cart', couponCode: null }), update: jest.fn() },
      cartItem: { upsert: jest.fn() },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    await expect(new UnpaidOrdersService(prisma as never, audit as never).abandon('o1', 'Payment failed')).resolves.toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3); // stock, deal quota, coupon counter
    expect(tx.inventoryMovement.create.mock.calls[0][0].data).toMatchObject({ variantId: 'v1', reason: 'RELEASE' });
    expect(tx.cartItem.upsert.mock.calls[0][0].create).toMatchObject({ variantId: 'v1', quantity: 2, priceSnapshotMinor: 5000n });
    expect(tx.cart.update).toHaveBeenCalledWith({ where: { id: 'cart' }, data: { couponCode: 'WELCOME10' } });
  });
});

describe('Payment webhooks', () => {
  const secret = 'webhook-secret-'.padEnd(48, 'x');
  const provider = new TestPaymentProvider({ get: (k: string) => (k === 'NODE_ENV' ? 'test' : secret) } as never);
  const signed = (body: object) => {
    const raw = Buffer.from(JSON.stringify(body));
    return { raw, headers: { 'x-test-signature': createHmac('sha256', secret).update(raw).digest('hex') } };
  };
  function build(orderStatus: string) {
    const tx = { payment: { update: jest.fn() }, refund: { upsert: jest.fn() }, order: { update: jest.fn() }, sellerOrder: { updateMany: jest.fn() }, orderItem: { updateMany: jest.fn() }, orderStatusHistory: { create: jest.fn() } };
    const prisma = {
      webhookEvent: { create: jest.fn(), updateMany: jest.fn() },
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', orderId: 'o1', status: 'PENDING', amountMinor: 10001n, currencyCode: 'QAR', order: { status: orderStatus, orderNumber: 'FMX-1' } }), update: jest.fn() },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    const ledger = { post: jest.fn() };
    const orderLedger = { postCapture: jest.fn() };
    const unpaid = { abandon: jest.fn() };
    const svc = new PaymentsService(prisma as never, audit as never, orderLedger as never, ledger as never, unpaid as never, {} as never, provider);
    return { svc, tx, ledger, orderLedger, unpaid };
  }

  it('failed payment for a pending order releases everything', async () => {
    const { svc, unpaid } = build('PENDING');
    const { raw, headers } = signed({ id: 'e1', type: 'payment.failed', ref: 'r', status: 'FAILED' });
    await svc.handleWebhook('test', headers, raw);
    expect(unpaid.abandon).toHaveBeenCalledWith('o1', 'Payment failed at the gateway');
  });

  it('capture for a pending order confirms it and posts the ledger', async () => {
    const { svc, tx, orderLedger } = build('PENDING');
    const { raw, headers } = signed({ id: 'e2', type: 'payment.captured', ref: 'r', status: 'CAPTURED' });
    await svc.handleWebhook('test', headers, raw);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'CONFIRMED' } });
    expect(orderLedger.postCapture).toHaveBeenCalledWith('o1', tx);
  });

  it('capture for an already-cancelled order is recorded as owed back and a refund is opened', async () => {
    const { svc, tx, ledger, orderLedger } = build('CANCELLED');
    const { raw, headers } = signed({ id: 'e3', type: 'payment.captured', ref: 'r', status: 'CAPTURED' });
    await svc.handleWebhook('test', headers, raw);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(orderLedger.postCapture).not.toHaveBeenCalled();
    expect(ledger.post.mock.calls[0][0].entries).toEqual([
      { type: 'CUSTOMER_CLEARING', amountMinor: -10001n },
      { type: 'REFUND_PAYABLE', amountMinor: 10001n },
    ]);
    expect(tx.refund.upsert.mock.calls[0][0].create).toMatchObject({ amountMinor: 10001n, status: 'PENDING', idempotencyKey: 'late_payment_p1' });
  });
});

describe('Market settings', () => {
  const qa = { code: 'QA', vatRateBps: 0, pricesIncludeTax: true, paymentMethods: ['CARD', 'COD'], deliveryConfig: { flatFeeMinor: '1000', freeOverMinor: '10000' }, isActive: true };
  const make = (update = jest.fn().mockResolvedValue({})) => ({
    svc: new CountriesAdminService({ country: { findUnique: jest.fn().mockResolvedValue(qa), update } } as never, new MemoryCacheService(), audit as never, { cardProvider: () => 'test' } as never),
    update,
  });
  const admin = { id: 'a', roles: ['ADMIN'], permissions: [] };

  it('an open market needs a payment method', async () => {
    await expect(make().svc.update('QA', { paymentMethods: [] }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('the default market cannot be closed', async () => {
    await expect(make().svc.update('qa', { isActive: false }, admin)).rejects.toThrow('default market');
  });
  it('delivery pricing is merged, not replaced', async () => {
    const { svc, update } = make();
    await svc.update('QA', { deliveryConfig: { flatFeeMinor: '1500' } }, admin);
    expect(update.mock.calls[0][0].data.deliveryConfig).toEqual({ flatFeeMinor: '1500', freeOverMinor: '10000' });
  });
});
