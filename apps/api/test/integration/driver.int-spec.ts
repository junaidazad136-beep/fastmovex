/**
 * The driver page on a real database: drivers may sign in to the panel app (and only use their own jobs), today's run
 * comes in driving order with everything needed at the door (name, phone, map link, cash), a failed attempt can be
 * retried, the customer's code is the proof, and staff assign jobs.
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
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
interface RunJob { id: string; status: string; orderNumber: string; customer: { name: string; phone: string }; address: { zone: string; mapUrl: string }; cash: { amountMinor: string } | null; pickup: { name: string } }

describe('Driver page — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const runOf = async () => (await api().get('/api/v1/courier/jobs/run').set(bearer(s.courier)).expect(200)).body as { summary: Record<string, unknown>; jobs: RunJob[] };

  async function fleetOrder(zone: string, name: string) {
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `drv-${run}-${zone}`).send({
      contact: { fullName: name, email: `drv.${zone}.${run}@example.com`, phone: `+974555${zone.padStart(5, '0')}` },
      address: { recipientName: name, phone: `+974555${zone.padStart(5, '0')}`, city: 'Doha', zone, street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { sellerOrders: true } });
    const so = o.sellerOrders[0].id;
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    let d = null;
    for (let i = 0; i < 50 && !d; i++) { // opened in the background by the shipment-status listener
      d = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: so } });
      if (!d) await new Promise((r) => setTimeout(r, 100));
    }
    if (!d) throw new Error('no delivery record');
    return { orderNumber: o.orderNumber, total: o.totalMinor.toString(), delivery: d.id, code: d.deliveryCode! };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF' }); // not what this file tests
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    s.admin = await login('admin@demo.jovia.test');
    s.courier = await login('courier@demo.jovia.test');
    s.courierId = (await prisma.user.findFirstOrThrow({ where: { email: 'courier@demo.jovia.test' } })).id;
    // finish the demo courier's older jobs so this run starts clean
    await prisma.deliveryOrder.updateMany({ where: { courierUserId: s.courierId, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, data: { courierUserId: null, status: 'CANCELLED' } });

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title: `Driver Kettle ${run}`, categoryId: cat.id, variants: [{ sku: `DRV-${run}`, priceMinor: '4000', initialStock: 10 }] }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
    // jobs this driver already finished today (other tests) stay in the run: count from here
    const before = (await runOf()).summary as { delivered: number; failed: number; cashCollectedMinor: string };
    s.baseDelivered = String(before.delivered); s.baseFailed = String(before.failed); s.baseCash = before.cashCollectedMinor;
  });
  const mine = (jobs: RunJob[]) => jobs.filter((j) => j.id === s.near || j.id === s.far);

  afterAll(async () => { await restoreCod?.(); await app?.close(); });

  it('drivers may sign in to the panel app, but no staff screen answers them', async () => {
    const panel = await api().post('/api/v1/auth/login').set('X-Client-Type', 'admin').send({ identifier: 'courier@demo.jovia.test', password: DEMO_PASSWORD });
    expect(panel.status).toBe(200);
    await api().get('/api/v1/admin/orders').set(bearer(s.courier)).expect(403);
    await api().get('/api/v1/admin/deliveries').set(bearer(s.courier)).expect(403);
  });

  it('staff give jobs to a driver; the run lists them in driving order with what is needed at the door', async () => {
    const far = await fleetOrder('70', 'Maryam Far');
    const near = await fleetOrder('25', 'Hessa Near');
    s.far = far.delivery; s.near = near.delivery; s.code = near.code; s.nearTotal = near.total; s.farTotal = far.total;

    const waiting = (await api().get('/api/v1/admin/deliveries').query({ unassigned: true }).set(bearer(s.admin)).expect(200)).body as { id: string; sellerOrder: { warehouse: { name: string } } }[];
    expect(waiting.find((d) => d.id === s.near)?.sellerOrder.warehouse.name).toBe('Main warehouse');
    const summary = (await api().get('/api/v1/admin/dashboard/summary').set(bearer(s.admin)).expect(200)).body;
    expect(summary.deliveriesToAssign).toBeGreaterThanOrEqual(2);
    for (const id of [s.far, s.near]) await api().post(`/api/v1/admin/deliveries/${id}/assign`).set(bearer(s.admin)).send({ courierUserId: s.courierId }).expect(200);

    const r = await runOf();
    expect(r.jobs.slice(0, 2).map((j) => j.id)).toEqual([s.near, s.far]); // open jobs first; zone 25 before zone 70
    const first = r.jobs[0];
    expect(first).toMatchObject({ status: 'ASSIGNED', orderNumber: near.orderNumber, customer: { name: 'Hessa Near', phone: '+97455500025' }, cash: { amountMinor: near.total }, pickup: { name: 'Main warehouse' } });
    expect(first.address.mapUrl).toBe('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Building 12, Street 901, Zone 25, Doha, Qatar'));
    expect(r.summary).toMatchObject({ toDo: 2, delivered: Number(s.baseDelivered), cashToCollectMinor: String(BigInt(near.total) + BigInt(far.total)) });
  });

  it('pick up, on the way, a failed attempt, then try again', async () => {
    await api().post(`/api/v1/courier/jobs/${s.near}/out-for-delivery`).set(bearer(s.courier)).expect(400); // pick it up first
    await api().post(`/api/v1/courier/jobs/${s.near}/pickup`).set(bearer(s.courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${s.near}/out-for-delivery`).set(bearer(s.courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${s.near}/fail`).set(bearer(s.courier)).send({ reason: 'Customer not answering' }).expect(200);
    let r = await runOf();
    expect(mine(r.jobs).map((j) => [j.id, j.status])).toEqual([[s.far, 'ASSIGNED'], [s.near, 'FAILED']]); // finished ones go after open ones
    expect(r.summary).toMatchObject({ failed: Number(s.baseFailed) + 1, toDo: 1 });
    await api().post(`/api/v1/courier/jobs/${s.near}/out-for-delivery`).set(bearer(s.courier)).expect(200); // the customer called back
    r = await runOf();
    expect(r.jobs[0]).toMatchObject({ id: s.near, status: 'OUT_FOR_DELIVERY' });
    expect((await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: s.near } })).failureReason).toBeNull();
  });

  it('the customer’s code is the proof; a doorstep photo is kept private; cash counts as collected', async () => {
    const wrong = s.code === '0000' ? '1111' : '0000';
    await api().post(`/api/v1/courier/jobs/${s.near}/deliver`).set(bearer(s.courier)).field('code', wrong).expect(400);
    await api().post(`/api/v1/courier/jobs/${s.near}/deliver`).set(bearer(s.courier)).field('code', s.code).field('recipientName', 'Her brother').attach('photo', PNG, 'door.png').expect(200);
    const d = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: s.near }, include: { sellerOrder: { include: { order: { include: { payments: true } } } } } });
    expect(d).toMatchObject({ status: 'DELIVERED', recipientName: 'Her brother', attempts: 1 });
    expect(d.proofOfDeliveryKey).toMatch(/^deliveries\//);
    expect(d.sellerOrder.order.payments[0].status).toBe('CAPTURED'); // cash on delivery settled
    const r = await runOf();
    expect(r.summary).toMatchObject({ delivered: Number(s.baseDelivered) + 1, toDo: 1, cashCollectedMinor: String(BigInt(s.baseCash) + BigInt(s.nearTotal)), cashToCollectMinor: s.farTotal });
    const proof = (await api().get(`/api/v1/admin/deliveries/${s.near}/proof`).set(bearer(s.admin)).expect(200)).body;
    expect(proof.url).toMatch(/^https?:\/\//);
  });

  it('a driver never sees or touches another driver’s jobs', async () => {
    const other = await api().post('/api/v1/auth/register').send({ fullName: 'Other Person', email: `drv.other.${run}@jovia.test`, password: 'Buyer-Pass-123' }).expect(201);
    await api().get('/api/v1/courier/jobs/run').set(bearer(other.body.accessToken)).expect(403); // not a driver at all
    const steal = await api().post(`/api/v1/courier/jobs/${s.far}/pickup`).set(bearer(other.body.accessToken));
    expect([403, 404]).toContain(steal.status);
  });
});
