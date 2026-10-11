import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MemoryCacheService } from '../src/cache/cache.service';
import { NotificationListener } from '../src/notifications/notification.listener';
import { NotificationsService } from '../src/notifications/notifications.service';
import { formatMoney, render } from '../src/notifications/templates';
import { SellerProductsService } from '../src/products/seller-products.service';
import { displayName, initialStatus, ReviewsService } from '../src/reviews/reviews';
import { initialPriority, SupportService } from '../src/support/support';
import { WishlistAlerts, WishlistService } from '../src/wishlist/wishlist';

const audit = { log: jest.fn() };
const sender = (on = true) => ({ enabled: () => on, send: jest.fn() });

describe('templates', () => {
  it('interpolates plain text and caps values', () => {
    expect(render('Order {{orderNumber}} for {{missing}}', { orderNumber: 'FMX-1' })).toBe('Order FMX-1 for ');
    expect(render('{{x}}', { x: 'a'.repeat(1000) })).toHaveLength(300);
  });
  it('formats money per currency precision', () => {
    expect(formatMoney(12345n, 'QAR')).toBe('QAR 123.45');
    expect(formatMoney('1500', 'KWD', 3)).toBe('KWD 1.500');
    expect(formatMoney(-5n, 'QAR')).toBe('-QAR 0.05');
  });
});

describe('NotificationsService', () => {
  const user = (o: object = {}) => ({ status: 'ACTIVE', locale: 'en', email: 'a@b.com', phone: '+97455555555', fullName: 'Aisha Tester', marketingOptIn: false, whatsappOptIn: false, _count: { deviceTokens: 1 }, ...o });
  function build(u: unknown, senders: Record<string, ReturnType<typeof sender>> = { email: sender(), sms: sender(), push: sender() }) {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(u) }, notification: { createMany: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([]) };
    const wa = senders.whatsapp ?? { ...sender(), enabled: () => false };
    return { svc: new NotificationsService(prisma as never, senders.email as never, senders.sms as never, senders.push as never, wa as never), prisma };
  }

  it('promotions only go to users who opted in', async () => {
    const { svc, prisma } = build(user());
    await expect(svc.notify('u', 'PROMOTION', { title: 'Sale', body: '50% off' })).resolves.toEqual([]);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('picks channels from the template and what the user has', async () => {
    const { svc } = build(user());
    await expect(svc.notify('u', 'ORDER_OUT_FOR_DELIVERY', { orderNumber: 'FMX-1', store: 'S' })).resolves.toEqual(['IN_APP', 'PUSH', 'EMAIL', 'SMS']); // email too: it carries the delivery code
    await expect(svc.notify('u', 'REFUND_COMPLETED', { orderNumber: 'FMX-1', amount: 'QAR 10.00' })).resolves.toEqual(['IN_APP', 'PUSH', 'EMAIL']);
  });

  it('unconfigured channels are skipped, in-app always works', async () => {
    const { svc } = build(user(), { email: sender(false), sms: sender(false), push: sender(false) });
    await expect(svc.notify('u', 'REFUND_COMPLETED', {})).resolves.toEqual(['IN_APP']);
  });

  it('Arabic users get Arabic text', async () => {
    const { svc, prisma } = build(user({ locale: 'ar' }));
    await svc.notify('u', 'ORDER_CONFIRMED', { orderNumber: 'FMX-1' });
    expect(prisma.notification.createMany.mock.calls[0][0].data[0].title).toBe('تم تأكيد طلبك');
  });

  it('suspended users get nothing', async () => {
    await expect(build(user({ status: 'SUSPENDED' })).svc.notify('u', 'ORDER_CONFIRMED', {})).resolves.toEqual([]);
  });

  it('failed delivery is retried with backoff, then given up after 5 attempts', async () => {
    const email = { enabled: () => true, send: jest.fn().mockRejectedValue(new Error('provider down')) };
    const update = jest.fn();
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'n1' }]),
      notification: {
        findUnique: jest.fn().mockResolvedValue({ id: 'n1', channel: 'EMAIL', title: 't', body: 'b', data: {}, attempts: 1, user: { email: 'a@b.com', phone: null, deviceTokens: [] } }),
        update,
      },
    };
    const svc = new NotificationsService(prisma as never, email as never, sender() as never, sender() as never, sender(false) as never);
    await expect(svc.processQueue()).resolves.toEqual({ sent: 0, failed: 1 });
    expect(update.mock.calls[0][0].data.status).toBe('QUEUED');
    expect(update.mock.calls[0][0].data.nextAttemptAt).toBeInstanceOf(Date);

    prisma.notification.findUnique.mockResolvedValue({ id: 'n1', channel: 'EMAIL', title: 't', body: 'b', data: {}, attempts: 5, user: { email: 'a@b.com', phone: null, deviceTokens: [] } });
    await svc.processQueue();
    expect(update.mock.calls[1][0].data.status).toBe('FAILED');
  });
});

describe('NotificationListener', () => {
  it('only customer-relevant shipment steps notify (not PREPARING)', async () => {
    const notifications = { notify: jest.fn() };
    const prisma = { sellerOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue({ order: { userId: 'u', orderNumber: 'FMX-1' }, seller: { store: { name: 'Doha Gadgets' } } }) } };
    const l = new NotificationListener(prisma as never, notifications as never);
    await l.onShipment({ sellerOrderId: 'so', status: 'PREPARING' });
    expect(notifications.notify).not.toHaveBeenCalled();
    await l.onShipment({ sellerOrderId: 'so', status: 'SHIPPED' });
    expect(notifications.notify).toHaveBeenCalledWith('u', 'ORDER_SHIPPED', { orderNumber: 'FMX-1', store: 'Doha Gadgets' }, { orderNumber: 'FMX-1' });
  });

  it('a notification failure never propagates', async () => {
    const l = new NotificationListener({ order: { findUniqueOrThrow: jest.fn().mockRejectedValue(new Error('db')) } } as never, {} as never);
    await expect(l.onConfirmed({ orderId: 'o' })).resolves.toBeUndefined();
  });
});

describe('Reviews', () => {
  it('privacy-safe author names', () => {
    expect(displayName('Junaid Azad Muhammad')).toBe('Junaid M.');
    expect(displayName('Junaid')).toBe('Junaid');
  });
  it('rating-only reviews publish, text/photos are moderated', () => {
    expect(initialStatus()).toBe('APPROVED');
    expect(initialStatus('Great')).toBe('PENDING');
    expect(initialStatus(null, true)).toBe('PENDING');
  });

  const make = (prisma: object) => new ReviewsService(prisma as never, { publicUrl: () => null } as never, audit as never);
  it('only verified, delivered purchases can be reviewed', async () => {
    await expect(make({ orderItem: { findFirst: jest.fn().mockResolvedValue(null) } }).create('u', { orderItemId: 'i', target: 'PRODUCT', rating: 5 })).rejects.toBeInstanceOf(NotFoundException);
    const notDelivered = { id: 'i', status: 'SHIPPED', sellerOrder: { sellerId: 's', deliveredAt: null }, variant: { productId: 'p' } };
    await expect(make({ orderItem: { findFirst: jest.fn().mockResolvedValue(notDelivered) } }).create('u', { orderItemId: 'i', target: 'PRODUCT', rating: 5 })).rejects.toThrow('after the item is delivered');
  });
  it('duplicate review -> 409', async () => {
    const { Prisma } = await import('@prisma/client');
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' });
    const prisma = {
      orderItem: { findFirst: jest.fn().mockResolvedValue({ id: 'i', status: 'DELIVERED', sellerOrder: { sellerId: 's', deliveredAt: new Date() }, variant: { productId: 'p' } }) },
      review: { create: jest.fn().mockRejectedValue(dup) },
    };
    await expect(make(prisma).create('u', { orderItemId: 'i', target: 'PRODUCT', rating: 5 })).rejects.toBeInstanceOf(ConflictException);
  });
  it('ratings are recomputed from approved reviews, never incremented', async () => {
    const update = jest.fn();
    const prisma = { review: { aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 }) }, product: { update }, store: { updateMany: jest.fn() } };
    await make(prisma).recompute('p', null);
    expect(update).toHaveBeenCalledWith({ where: { id: 'p' }, data: { ratingAvg: 4.5, ratingCount: 2 } });
  });
});

describe('Wishlist', () => {
  it('default list cannot be deleted', async () => {
    const prisma = { wishlist: { findFirst: jest.fn().mockResolvedValue({ id: 'w', isDefault: true }) } };
    const svc = new WishlistService(prisma as never, {} as never, {} as never, {} as never);
    await expect(svc.deleteList('u', 'w')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('move to cart picks the cheapest IN-STOCK variant', async () => {
    const addItem = jest.fn().mockResolvedValue({ ok: true });
    const prisma = {
      wishlistItem: { findFirst: jest.fn().mockResolvedValue({ id: 'wi' }), deleteMany: jest.fn() },
      productVariant: { findMany: jest.fn().mockResolvedValue([{ id: 'cheap-soldout', inventory: { onHand: 2, reserved: 2 } }, { id: 'next', inventory: { onHand: 5, reserved: 0 } }]) },
    };
    const countries = { resolve: jest.fn().mockResolvedValue({ code: 'QA' }) };
    await new WishlistService(prisma as never, {} as never, { addItem } as never, countries as never).moveToCart('u', 'p', {});
    expect(addItem.mock.calls[0][1]).toBe('next');
    expect(prisma.wishlistItem.deleteMany).toHaveBeenCalled();
  });

  it('price drop alert: only below saved price, once a day, saved price moves down', async () => {
    const notify = jest.fn();
    const updateMany = jest.fn();
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p', slug: 'p', title: 'Oud', minPriceMinor: 8000n, variants: [{ currencyCode: 'QAR' }] }) },
      wishlistItem: { findMany: jest.fn().mockResolvedValue([{ id: 'wi', wishlist: { userId: 'u', user: { locale: 'en' } } }]), updateMany },
    };
    const alerts = new WishlistAlerts(prisma as never, { notify } as never, new MemoryCacheService());
    await alerts.onPriceChanged({ id: 'p' });
    await alerts.onPriceChanged({ id: 'p' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('u', 'PRICE_DROP', { product: 'Oud', price: 'QAR 80.00', link: '' }, { productSlug: 'p' });
    expect(prisma.wishlistItem.findMany.mock.calls[0][0].where).toMatchObject({ priceAtAddMinor: { gt: 8000n }, notifyPriceDrop: true });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['wi'] } }, data: { priceAtAddMinor: 8000n } });
  });
});

describe('Catalog events', () => {
  const variant = { id: 'v', productId: 'p', priceMinor: 10000n, compareAtMinor: null, product: { deletedAt: null, store: { sellerId: 'A' } } };
  const seller = { id: 'A', status: 'APPROVED', countryCode: 'QA' };

  it('a price cut emits PRICE_CHANGED (drives wishlist alerts)', async () => {
    const events = { emit: jest.fn() };
    const prisma = {
      productVariant: { findUnique: jest.fn().mockResolvedValue(variant), update: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _min: { priceMinor: 8000n } }) },
      product: { update: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'p', images: [], variants: [] }) },
    };
    const svc = new SellerProductsService(prisma as never, audit as never, { publicUrl: () => null } as never, events as never);
    await svc.updateVariant(seller, 'v', { priceMinor: '8000' }, 'u');
    expect(events.emit).toHaveBeenCalledWith('product.price_changed', { id: 'p' });
  });

  it('restocking a sold-out variant emits VARIANT_RESTOCKED', async () => {
    const events = { emit: jest.fn() };
    const tx = { inventory: { findUniqueOrThrow: jest.fn().mockResolvedValueOnce({ id: 'i', onHand: 0, reserved: 0, version: 1 }).mockResolvedValueOnce({ onHand: 5, reserved: 0 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = { productVariant: { findUnique: jest.fn().mockResolvedValue(variant) }, $transaction: (fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx)) };
    const warehouses = { ownWarehouse: jest.fn().mockResolvedValue('wh'), move: jest.fn() };
    const svc = new SellerProductsService(prisma as never, audit as never, {} as never, events as never, warehouses as never);
    await svc.adjustStock(seller, 'v', { delta: 5, reason: 'RESTOCK' }, 'u');
    expect(events.emit).toHaveBeenCalledWith('variant.restocked', { id: 'v' });
  });
});

describe('Support', () => {
  it('payment/refund tickets get HIGH priority', () => {
    expect(initialPriority('refund')).toBe('HIGH');
    expect(initialPriority('delivery')).toBe('NORMAL');
  });
  const make = (prisma: object) => new SupportService(prisma as never, audit as never, new MemoryCacheService());

  it('customers never see internal staff notes', async () => {
    const findFirst = jest.fn().mockResolvedValue({ number: 'SUP-1', subject: 's', category: 'order', status: 'OPEN', createdAt: new Date(), order: null, messages: [] });
    await make({ supportTicket: { findFirst } }).detailMine('u', 'SUP-1');
    expect(findFirst.mock.calls[0][0].select.messages.where).toEqual({ isInternal: false });
    expect(findFirst.mock.calls[0][0].where).toEqual({ number: 'SUP-1', userId: 'u' });
  });
  it('closed tickets cannot be replied to', async () => {
    await expect(make({ supportTicket: { findFirst: jest.fn().mockResolvedValue({ id: 't', status: 'CLOSED' }) } }).replyAsCustomer('u', 'SUP-1', 'hi')).rejects.toThrow('closed');
  });
  it('limits open tickets per user (spam protection)', async () => {
    await expect(make({ supportTicket: { count: jest.fn().mockResolvedValue(10) } }).create('u', { subject: 'Help me', category: 'order', message: 'where is my order?' })).rejects.toThrow('too many open tickets');
  });
  it("cannot attach someone else's order", async () => {
    const prisma = { supportTicket: { count: jest.fn().mockResolvedValue(0) }, order: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(make(prisma).create('u', { subject: 'Help me', category: 'order', message: 'where is my order?', orderNumber: 'FMX-QA-X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
