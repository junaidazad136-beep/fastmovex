/**
 * PHASE 34 on a real database: five ways real shoppers break a shop without meaning to (or on purpose),
 * and what the API must do about each one.
 *  1. Everybody taps "Order" for the LAST item at the same second      -> exactly one order, stock never below zero
 *  2. Impatient double / triple tap on "Pay"                           -> one order, not three
 *  3. Nonsense quantities typed or sent by a script                    -> refused cleanly, the cart still works
 *  4. Hostile or huge text in search and in the address form            -> never a server error
 *  5. A script that edits the price in the request                     -> the order is charged the server's price
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

describe('How real shoppers break things — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  const order = (n: number, over: Record<string, unknown> = {}) => {
    const ph = phone();
    return {
      contact: { fullName: `Shopper ${n}`, email: `abuse${n}.${run}.${randomBytes(2).toString('hex')}@example.com`, phone: ph },
      address: { recipientName: `Shopper ${n}`, phone: ph, city: 'Doha', zone: '66', street: '901', building: '12' },
      paymentMethod: 'COD',
      ...over,
    };
  };
  async function product(label: string, stock: number) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `${label} ${run}`, titleAr: 'منتج', categoryId: cat.id, tags: [`abuse${run}`],
      variants: [{ sku: `AB-${label.slice(0, 3).toUpperCase()}-${run}`, priceMinor: '2500', initialStock: stock }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    return { id: p.body.id as string, variantId: p.body.variants[0].id as string };
  }
  const cartFor = async (variantId: string, quantity = 1) => {
    const res = await api().post('/api/v1/cart/items').send({ variantId, quantity }).expect(201);
    return res.body.cartToken as string;
  };
  const place = (token: string, body: Record<string, unknown>, key: string) =>
    api().post('/api/v1/checkout/guest').set('x-cart-token', token).set('Idempotency-Key', key).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockImplementation(async () => undefined);
    const login = await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.fastmovex.test', password: DEMO_PASSWORD });
    s.admin = login.body.accessToken;
    await prisma.country.update({ where: { code: 'QA' }, data: { guestCheckout: true } });
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null });
  });
  afterAll(async () => {
    await restoreCod?.().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('1. five shoppers order the last item at the same second: one gets it, stock never goes below zero', async () => {
    const p = await product('Last Piece', 1);
    const carts = await Promise.all([1, 2, 3, 4, 5].map(() => cartFor(p.variantId)));
    const results = await Promise.all(carts.map((t, i) => place(t, order(i), `race-${run}-${i}`)));
    const won = results.filter((r) => r.status === 201);
    expect(results.every((r) => r.status < 500)).toBe(true); // nobody sees a crash
    expect(won).toHaveLength(1);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: p.variantId } });
    expect(inv.onHand - inv.reserved).toBeGreaterThanOrEqual(0);
    expect(inv.reserved).toBeLessThanOrEqual(inv.onHand);
    expect(await prisma.orderItem.count({ where: { variantId: p.variantId } })).toBe(1);
  });

  it('2. tapping Pay three times with the same request makes one order, not three', async () => {
    const p = await product('Double Tap', 10);
    const token = await cartFor(p.variantId, 2);
    const body = order(9);
    const key = `dbl-${run}`;
    const results = await Promise.all([0, 1, 2].map(() => place(token, body, key)));
    expect(results.map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)).toEqual(expect.not.arrayContaining([expect.stringMatching(/^5/)]));
    const numbers = new Set(results.filter((r) => r.status === 201 || r.status === 200).map((r) => r.body.orderNumber));
    expect(numbers.size).toBe(1);
    expect(await prisma.orderItem.count({ where: { variantId: p.variantId } })).toBe(1);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: p.variantId } });
    expect(inv.reserved).toBe(2); // two pieces held once, not six
  });

  it('3. nonsense quantities are refused cleanly and the cart keeps working', async () => {
    const p = await product('Silly Quantity', 5);
    const token = await cartFor(p.variantId, 1);
    for (const quantity of [0, -3, 1.5, 999_999, 'abc', null, {}, [1]]) {
      const res = await api().post('/api/v1/cart/items').set('x-cart-token', token).send({ variantId: p.variantId, quantity });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    const tooMany = await api().post('/api/v1/cart/items').set('x-cart-token', token).send({ variantId: p.variantId, quantity: 50 });
    expect(tooMany.status).toBeGreaterThanOrEqual(400);
    expect(tooMany.status).toBeLessThan(500); // more than the shelf holds
    const cart = await api().get('/api/v1/cart').set('x-cart-token', token).expect(200);
    expect(JSON.stringify(cart.body)).toContain(p.variantId); // the one good item is still there
  });

  it('4. hostile or huge text in search and the address form never causes a server error', async () => {
    const nasty = ["'; DROP TABLE users; --", '<script>alert(1)</script>', '%', '_', '\\', '😀'.repeat(200), 'مرحبا'.repeat(300), 'a'.repeat(5000), '\u0000', '   '];
    for (const q of nasty) {
      const res = await api().get('/api/v1/search').query({ q });
      expect(res.status).toBeLessThan(500);
    }
    const p = await product('Hostile Text', 5);
    const token = await cartFor(p.variantId);
    const bad = order(7, { address: { recipientName: '<img src=x onerror=alert(1)>'.repeat(500), phone: phone(), city: 'Doha', zone: '66', street: 'x'.repeat(10_000), building: '1' } });
    const res = await place(token, bad, `host-${run}`);
    expect(res.status).toBeGreaterThanOrEqual(400); // refused, not stored
    expect(res.status).toBeLessThan(500);
    const tables = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "User"`;
    expect(Number(tables[0].n)).toBeGreaterThan(0); // the "DROP TABLE" did nothing
  });

  it('5. a script that sets its own price in the request is charged the shop price', async () => {
    const p = await product('Cheap Trick', 5);
    const add = await api().post('/api/v1/cart/items').send({ variantId: p.variantId, quantity: 2, priceMinor: '1', unitPriceMinor: '1', totalMinor: '1' });
    expect(add.status).toBeLessThan(500);
    const token = add.status === 201 ? (add.body.cartToken as string) : await cartFor(p.variantId, 2);
    const res = await place(token, { ...order(5), totalMinor: '1', priceMinor: '1', shippingMinor: '0' }, `price-${run}`);
    if (res.status === 201) {
      const o = await prisma.order.findFirstOrThrow({ where: { orderNumber: res.body.orderNumber } });
      expect(o.subtotalMinor).toBe(BigInt(5000)); // 2 x QAR 25.00, whatever the request claimed
      expect(o.totalMinor).toBeGreaterThanOrEqual(BigInt(5000));
    } else {
      expect(res.status).toBeLessThan(500); // refused is also fine
    }
  });
});
