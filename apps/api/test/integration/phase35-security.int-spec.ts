/**
 * Security audit 2026-11-18 on a real database:
 *  1. A stranger who knows a guest's email cannot put their own phone or name on that guest profile,
 *     and a phone that is not proven never receives a password-reset code.
 *  2. The order lookup ("track my order" without an account) works only for guest orders.
 *  3. Parallel checkouts by one customer use a once-per-customer promo code at most once.
 *  4. Two return requests at the same time cannot open more units than were bought.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9745${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

describe('Security audit fixes — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sent: { to: string; body: string }[] = [];
  const s: Record<string, string> = {};

  const cartFor = async (quantity = 1) => (await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity }).expect(201)).body.cartToken as string;
  const guestOrder = (email: string, ph: string, name: string) => ({
    contact: { fullName: name, email, phone: ph },
    address: { recipientName: name, phone: ph, city: 'Doha', zone: '66', street: '901', building: '12' },
    paymentMethod: 'COD',
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockImplementation(async (_c, to, _t, body) => { sent.push({ to, body }); });
    s.admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: DEMO_PASSWORD })).body.accessToken;
    await prisma.country.update({ where: { code: 'QA' }, data: { guestCheckout: true } });
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null });
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Audit item ${run}`, titleAr: 'منتج', categoryId: cat.id,
      variants: [{ sku: `AUD-${run}`, priceMinor: '5000', initialStock: 50 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
  });
  afterAll(async () => {
    await restoreCod?.().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('1. a stranger cannot take over a guest profile by its email', async () => {
    const victimEmail = `victim.${run}@example.com`;
    const victimPhone = phone();
    const victimCart = await cartFor();
    const placed = await api().post('/api/v1/checkout/guest').set('x-cart-token', victimCart).set('Idempotency-Key', `v-${run}`)
      .send(guestOrder(victimEmail, victimPhone, 'Real Victim'));
    expect(placed.status).toBe(201);
    const before = await prisma.user.findUniqueOrThrow({ where: { email: victimEmail }, select: { id: true, fullName: true, phone: true } });

    const attackerPhone = phone();
    const attackerCart = await cartFor();
    await api().post('/api/v1/checkout/guest').set('x-cart-token', attackerCart).set('Idempotency-Key', `a-${run}`)
      .send(guestOrder(victimEmail, attackerPhone, 'Attacker'));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id }, select: { fullName: true, phone: true, isGuest: true } });
    expect(after).toMatchObject({ fullName: 'Real Victim', phone: before.phone, isGuest: true });

    // a reset code is never texted to a guest profile's phone (it was never proven to belong to the email owner)
    sent.length = 0;
    await api().post('/api/v1/auth/password/forgot').send({ identifier: victimPhone }).expect(202);
    await api().post('/api/v1/auth/password/forgot').send({ identifier: attackerPhone }).expect(202);
    await new Promise((r) => setTimeout(r, 800));
    expect(sent.filter((m) => m.to === victimPhone || m.to === attackerPhone)).toHaveLength(0);
  });

  it('3. parallel checkouts use a once-per-customer promo code only once', async () => {
    const code = `ONCE${run}`.toUpperCase();
    await prisma.coupon.create({ data: {
      code, countryCode: 'QA', type: 'FIXED', scope: 'PLATFORM', valueMinor: 500n, perUserLimit: 1,
      startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 86_400_000), isActive: true,
    } as never });
    const reg = await api().post('/api/v1/auth/register').set('X-Client-Type', 'mobile')
      .send({ fullName: 'Race Tester', email: `race.${run}@example.com`, phone: phone(), password: `Race-Pass-${run}-2026` }).expect(201);
    const t = reg.body.accessToken as string;
    await api().post('/api/v1/cart/items').set(bearer(t)).send({ variantId: s.variant, quantity: 1 }).expect(201);
    await api().post('/api/v1/cart/coupon').set(bearer(t)).send({ code }).expect(201);
    const address = await api().post('/api/v1/addresses').set(bearer(t))
      .send({ label: 'Home', recipientName: 'Race Tester', phone: '+97455512345', city: 'Doha', zone: '66', street: '901', building: '12' }).expect(201);
    const results = await Promise.all([1, 2, 3, 4].map((i) =>
      api().post('/api/v1/checkout').set(bearer(t)).set('Idempotency-Key', `race-${run}-${i}`).send({ addressId: address.body.id, paymentMethod: 'CARD' })));
    expect(results.every((r) => r.status < 500)).toBe(true);
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { code }, select: { id: true } });
    expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBeLessThanOrEqual(1);
  });

  it('2. order lookup refuses a registered customer\'s order', async () => {
    const o = await prisma.order.findFirstOrThrow({ where: { user: { isGuest: false, email: `race.${run}@example.com` } }, select: { orderNumber: true } });
    const res = await api().post('/api/v1/orders/guest/lookup').send({ orderNumber: o.orderNumber, contact: `race.${run}@example.com` });
    expect(res.status).toBe(401);
  });

  it('4. two return requests at once cannot return more than was bought', async () => {
    // the race tester's order from test 3, marked delivered
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { user: { email: `race.${run}@example.com` } }, quantity: 1 },
      select: { id: true, sellerOrderId: true, order: { select: { orderNumber: true } } },
    });
    await prisma.sellerOrder.update({ where: { id: item.sellerOrderId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    await prisma.orderItem.update({ where: { id: item.id }, data: { status: 'DELIVERED' } });
    const t = (await api().post('/api/v1/auth/login').send({ identifier: `race.${run}@example.com`, password: `Race-Pass-${run}-2026` }).expect(200)).body.accessToken;
    const body = { orderItemId: item.id, quantity: 1, reason: 'Changed my mind', reasonType: 'CHANGE_OF_MIND' };
    const res = await Promise.all([1, 2, 3, 4].map(() => api().post(`/api/v1/orders/${item.order.orderNumber}/returns`).set(bearer(t)).send(body)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.returnRequest.count({ where: { orderItemId: item.id } })).toBe(1);
  });
});
