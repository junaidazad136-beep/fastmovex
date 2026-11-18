/**
 * Seller policy §10 on a real database:
 *  1. A seller who cancels an order pays QAR 10 from their balance (once), and is told.
 *  2. An order not ready after 24 hours gets one late warning (48 hours for Friday orders); FastMoveX's own store is not warned.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { LatePackingService, packHoursFor } from '../../src/sellers/late-packing';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const phone = () => `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

describe('Seller rules — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  async function sellerOrder(): Promise<{ id: string; orderNumber: string }> {
    const cart = (await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201)).body.cartToken as string;
    const ph = phone();
    const placed = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart).set('Idempotency-Key', `sr-${run}-${randomBytes(3).toString('hex')}`).send({
      contact: { fullName: 'Rules Buyer', email: `rules.${run}.${randomBytes(2).toString('hex')}@example.com`, phone: ph },
      address: { recipientName: 'Rules Buyer', phone: ph, city: 'Doha', zone: '66', street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    const so = await prisma.sellerOrder.findFirstOrThrow({ where: { order: { orderNumber: placed.body.orderNumber } }, select: { id: true } });
    return { id: so.id, orderNumber: placed.body.orderNumber };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockImplementation(async () => undefined);
    await prisma.country.update({ where: { code: 'QA' }, data: { guestCheckout: true } });
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null });
    s.seller = (await api().post('/api/v1/auth/login').send({ identifier: 'seller.gadgets@demo.fastmovex.test', password: DEMO_PASSWORD })).body.accessToken;
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'seller.gadgets@demo.fastmovex.test' }, select: { seller: { select: { id: true } } } });
    s.sellerId = me.seller!.id;
    const v = await prisma.productVariant.findFirstOrThrow({
      where: { product: { status: 'ACTIVE', store: { sellerId: s.sellerId } }, isActive: true, inventory: { onHand: { gt: 5 } } },
      select: { id: true },
    });
    s.variant = v.id;
  });
  afterAll(async () => {
    await restoreCod?.().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  const feeTxns = (id: string) => prisma.ledgerTransaction.findMany({ where: { refType: 'seller_cancel_fee', refId: id }, include: { entries: { include: { account: true } } } });

  it('1. a seller cancellation costs QAR 10 from the balance, once, and the seller is told', async () => {
    const so = await sellerOrder();
    await api().post(`/api/v1/seller/orders/${so.id}/cancel`).set(bearer(s.seller)).send({ reason: 'Out of stock, sorry' }).expect(200);
    const txns = await feeTxns(so.id);
    expect(txns).toHaveLength(1);
    const seller = txns[0].entries.find((e) => e.account.type === 'SELLER_AVAILABLE')!;
    expect(seller.amountMinor).toBe(-1000n);
    expect(seller.account.sellerId).toBe(s.sellerId);
    await api().post(`/api/v1/seller/orders/${so.id}/cancel`).set(bearer(s.seller)).send({ reason: 'again' });
    expect(await feeTxns(so.id)).toHaveLength(1);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'seller.gadgets@demo.fastmovex.test' }, select: { id: true } });
    for (let i = 0; i < 30 && !(await prisma.notification.count({ where: { userId: owner.id, type: 'SELLER_CANCEL_FEE' } })); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.notification.count({ where: { userId: owner.id, type: 'SELLER_CANCEL_FEE' } })).toBeGreaterThan(0);
  });

  it('2. late packing: one warning after 24 hours, none before; Friday orders get 48 hours', async () => {
    expect(packHoursFor(new Date('2026-11-20T08:00:00Z'))).toBe(48); // Friday 11:00 in Doha
    expect(packHoursFor(new Date('2026-11-19T22:00:00Z'))).toBe(48); // Friday 01:00 in Doha
    expect(packHoursFor(new Date('2026-11-19T20:00:00Z'))).toBe(24); // Thursday 23:00 in Doha

    const so = await sellerOrder();
    const svc = app.get(LatePackingService);
    const created = new Date('2026-11-17T08:00:00Z'); // a Tuesday
    await prisma.sellerOrder.update({ where: { id: so.id }, data: { createdAt: created } });
    await svc.run(new Date(created.getTime() + 23 * 3_600_000));
    expect((await prisma.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).lateWarnedAt).toBeNull();
    await svc.run(new Date(created.getTime() + 25 * 3_600_000));
    const warned = (await prisma.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).lateWarnedAt;
    expect(warned).not.toBeNull();
    await svc.run(new Date(created.getTime() + 30 * 3_600_000));
    expect((await prisma.sellerOrder.findUniqueOrThrow({ where: { id: so.id } })).lateWarnedAt).toEqual(warned); // once only
  });
});
