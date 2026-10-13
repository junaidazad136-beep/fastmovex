/**
 * Delivery time slots on a real database: settings, the checkout listing, required choice, capacity under contention,
 * places given back when an order is cancelled (customer or unpaid expiry), guests, and the staff day view.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { UnpaidOrdersService } from '../../src/orders/unpaid-orders.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toLowerCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
interface Slot { start: string; end: string; from: string; to: string; left: number; available: boolean }
interface Listing { enabled: boolean; required: boolean; days: { date: string; slots: Slot[] }[] }

describe('Delivery time slots — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  let original: unknown;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }
  async function customer(tag: string) {
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Slot Buyer', email: `slots.${tag}.${run}@fastmovex.test`, password: 'Buyer-Pass-123' }).expect(201);
    const token = reg.body.accessToken as string;
    const address = (await api().post('/api/v1/addresses').set(bearer(token)).send({ recipientName: 'Buyer', phone: '+97455500044', city: 'Doha', zone: '60', street: '800', building: '3' }).expect(201)).body.id as string;
    return { token, address };
  }
  async function checkout(c: { token: string; address: string }, body: Record<string, unknown>, variant = s.variant) {
    await api().delete('/api/v1/cart').set(bearer(c.token));
    await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: variant, quantity: 1 }).expect(201);
    return api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `slot-${randomBytes(6).toString('hex')}`)
      .send({ addressId: c.address, paymentMethod: 'COD', ...body });
  }
  const listing = async () => (await api().get('/api/v1/delivery/slots').set('x-country', 'QA').expect(200)).body as Listing;
  /** The small window (one free place) on the last offered day: always in the future, whatever time the test runs. */
  const smallWindow = async () => (await listing()).days.at(-1)!.slots.find((x) => x.from === '14:00')!;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF' }); // not what this file tests
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    original = (await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } })).deliverySlots;
    s.admin = await login('admin@demo.fastmovex.test');

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    for (const [key, price] of [['variant', '4500'], ['pendingVariant', '4501']] as const) {
      const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
        title: `Slot Item ${key} ${run}`, titleAr: 'منتج', categoryId: cat.id, variants: [{ sku: `SL-${key}-${run}`, priceMinor: price, initialStock: 50 }],
      }).expect(201);
      await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
      await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
      s[key] = p.body.variants[0].id;
    }
  });

  afterAll(async () => { await restoreCod?.();
    await prisma?.country.update({ where: { code: 'QA' }, data: { deliverySlots: (original ?? {}) as object } }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('staff set delivery windows; impossible settings are refused', async () => {
    const bad = await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ deliverySlots: { enabled: true, windows: [{ start: '14:00', end: '09:00', capacity: 1 }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/end after it starts/);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({
      deliverySlots: { enabled: true, required: true, daysAhead: 3, leadMinutes: 0, closedWeekdays: [], closedDates: [], windows: [{ start: '08:00', end: '14:00', capacity: 1000 }, { start: '14:00', end: '20:00', capacity: 1 }] },
    }).expect(200);
    const support = await login('support@demo.fastmovex.test');
    await api().patch('/api/v1/admin/countries/QA').set(bearer(support)).send({ deliverySlots: { enabled: false } }).expect(403);
  });

  it('the checkout lists the open days and windows with what is left', async () => {
    // Repeatable on the same database: earlier runs may hold places in this window, so leave exactly one free.
    const target = (await listing()).days.at(-1)!.slots.find((x) => x.from === '14:00')!;
    const usage = await prisma.deliverySlotUsage.findUnique({ where: { countryCode_slotStart: { countryCode: 'QA', slotStart: new Date(target.start) } } });
    s.cap = String((usage?.booked ?? 0) + 1);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({
      deliverySlots: { enabled: true, required: true, daysAhead: 3, leadMinutes: 0, closedWeekdays: [], closedDates: [], windows: [{ start: '08:00', end: '14:00', capacity: 1000 }, { start: '14:00', end: '20:00', capacity: Number(s.cap) }] },
    }).expect(200);
    const l = await listing();
    expect(l).toMatchObject({ enabled: true, required: true });
    expect(l.days.length).toBeGreaterThanOrEqual(2);
    const w = await smallWindow();
    expect(w).toMatchObject({ from: '14:00', to: '20:00', left: 1, available: true });
    expect(new Date(w.end).getTime() - new Date(w.start).getTime()).toBe(6 * 3600_000);
  });

  it('when a time is required, an order without one is refused and nothing is created', async () => {
    const a = await customer('a');
    s.a = a.token; s.aAddress = a.address;
    const before = await prisma.order.count();
    const res = await checkout(a, {});
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('SLOT_REQUIRED');
    const bogus = await checkout(a, { deliverySlot: '2020-01-01T06:00:00.000Z' });
    expect(bogus.status).toBe(400);
    expect(bogus.body.reason).toBe('SLOT_INVALID');
    expect(await prisma.order.count()).toBe(before);
  });

  it('the last place in a window goes to one customer only; cancelling gives it back', async () => {
    const w = await smallWindow();
    const a = { token: s.a, address: s.aAddress };
    const b = await customer('b');
    const c = await customer('c');
    // two customers race for the last place
    const [r1, r2] = await Promise.all([checkout(a, { deliverySlot: w.start }), checkout(b, { deliverySlot: w.start })]);
    const won = [r1, r2].filter((r) => r.status === 201);
    const lost = [r1, r2].filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost[0].body.reason).toBe('SLOT_FULL');
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: won[0].body.orderNumber } });
    expect(order.deliverySlotStart?.toISOString()).toBe(w.start);
    expect(order.deliverySlotEnd?.toISOString()).toBe(w.end);
    expect((await smallWindow())).toMatchObject({ left: 0, available: false });
    expect((await checkout(c, { deliverySlot: w.start })).status).toBe(409);

    // the winner cancels: the place is free again and the next customer gets it
    const winner = r1.status === 201 ? a : b;
    await api().post(`/api/v1/orders/${order.orderNumber}/cancel`).set(bearer(winner.token)).send({ reason: 'Changed my mind' }).expect((r) => expect([200, 201]).toContain(r.status));
    expect((await smallWindow()).left).toBe(1);
    const again = await checkout(c, { deliverySlot: w.start });
    expect(again.status).toBe(201);
    s.cOrder = again.body.orderNumber;
  });

  it('an unpaid card order that expires gives its place back', async () => {
    const big = (await listing()).days.at(-1)!.slots.find((x) => x.from === '08:00')!;
    const d = await customer('d');
    const res = await checkout(d, { deliverySlot: big.start, paymentMethod: 'CARD', returnUrl: 'http://localhost:3000/en/checkout/return' }, s.pendingVariant);
    expect(res.status).toBe(201);
    expect(res.body.payment.status).toBe('PENDING'); // sandbox: totals ending in .01 stay pending
    const usage = () => prisma.deliverySlotUsage.findUniqueOrThrow({ where: { countryCode_slotStart: { countryCode: 'QA', slotStart: new Date(big.start) } } });
    const before = (await usage()).booked;
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } });
    await app.get(UnpaidOrdersService).abandon(o.id, 'Payment was not completed in time');
    expect((await usage()).booked).toBe(before - 1);
  });

  it('guests choose a time too', async () => {
    const big = (await listing()).days.at(-1)!.slots.find((x) => x.from === '08:00')!;
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `gslot-${run}`).send({
      contact: { fullName: 'Guest Slot', email: `guest.slot.${run}@example.com`, phone: '+97455500055' },
      address: { recipientName: 'Guest Slot', phone: '+97455500055', city: 'Doha', zone: '66', street: '901', building: '12' },
      paymentMethod: 'COD', deliverySlot: big.start,
    }).expect(201);
    const view = await api().get(`/api/v1/orders/guest/${res.body.orderNumber}`).set('x-order-token', res.body.orderAccessToken).expect(200);
    expect(view.body.deliverySlotStart).toBe(big.start);
  });

  it('staff see each window of a day with its bookings, and can list that day\'s orders', async () => {
    const w = await smallWindow();
    const date = (await listing()).days.at(-1)!.date;
    const day = await api().get('/api/v1/admin/delivery-slots').query({ date }).set(bearer(s.admin)).expect(200);
    expect(day.body.windows.find((x: { from: string }) => x.from === '14:00')).toMatchObject({ capacity: Number(s.cap), booked: Number(s.cap), start: w.start });
    expect(day.body.orders.map((o: { orderNumber: string }) => o.orderNumber)).toContain(s.cOrder);
    const list = await api().get('/api/v1/admin/orders').query({ slotDate: date }).set(bearer(s.admin)).expect(200);
    const row = list.body.items.find((o: { orderNumber: string }) => o.orderNumber === s.cOrder);
    expect(row.deliverySlotStart).toBe(w.start);
    expect(list.body.items.every((o: { deliverySlotStart: string | null }) => o.deliverySlotStart && o.deliverySlotStart.startsWith(date.slice(0, 7)))).toBe(true);
    await api().get('/api/v1/admin/delivery-slots').query({ date: 'tomorrow' }).set(bearer(s.admin)).expect(400);
  });

  it('switched off: no picker, and an old choice from an open tab is ignored', async () => {
    await api().patch('/api/v1/admin/countries/QA').set(bearer(s.admin)).send({ deliverySlots: { enabled: false } }).expect(200);
    expect(await listing()).toMatchObject({ enabled: false, days: [] });
    const e = await customer('e');
    const res = await checkout(e, { deliverySlot: '2030-01-01T06:00:00.000Z' });
    expect(res.status).toBe(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } })).deliverySlotStart).toBeNull();
  });
});
