/**
 * PHASE 26 on a real database: a marketplace seller runs their shop from Seller Center — a new order shows up in
 * their summary, they print the 10 × 15 label + packing list (only for their own parcels), mark it packed and ready,
 * and the FastMoveX driver scans the label's QR to pick it up.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PayoutsService } from '../../src/finance/payouts.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');

describe('Phase 26 — Seller Center: labels and pick-up scan (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;
  const t: Record<string, string> = {};
  const pdfBody = (res: request.Response) => res.body as Buffer;
  const binary = (req: request.Test) => req.buffer(true).parse((res, cb) => { const parts: Buffer[] = []; res.on('data', (c: Buffer) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts))); });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF' });
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    t.admin = await login('admin@demo.jovia.test');
    t.gadgets = await login('seller.gadgets@demo.jovia.test');
    t.home = await login('seller.home@demo.jovia.test');
    t.courier = await login('courier@demo.jovia.test');
    t.courierId = (await prisma.user.findFirstOrThrow({ where: { email: 'courier@demo.jovia.test' } })).id;

    // a guest buys one of Doha Gadgets Hub's products, cash on delivery
    const v = await prisma.productVariant.findFirstOrThrow({
      where: { isActive: true, product: { status: 'ACTIVE', deletedAt: null, store: { seller: { owner: { email: 'seller.gadgets@demo.jovia.test' } } } }, inventory: { onHand: { gte: 5 } } },
      select: { id: true },
    });
    await api().post(`/api/v1/seller/variants/${v.id}/stock`).set(bearer(t.gadgets)).send({ delta: 2, reason: 'RESTOCK' }).expect(200); // the seller's own stock screen
    const cart = await api().post('/api/v1/cart/items').send({ variantId: v.id, quantity: 1 }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `p26-${run}`).send({
      contact: { fullName: 'Label Test', email: `p26.${run}@example.com`, phone: '+97455512626' },
      address: { recipientName: 'سارة Label', phone: '+97455512626', city: 'Doha', zone: '45', street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { sellerOrders: { include: { seller: { select: { owner: { select: { email: true } } } } } } } });
    t.orderNumber = o.orderNumber;
    t.so = o.sellerOrders.find((so) => so.seller.owner.email === 'seller.gadgets@demo.jovia.test')!.id;
  });

  afterAll(async () => { await restoreCod?.(); await app?.close(); });

  it('the new order is in the seller\'s summary (counts by stage, newest new order, products by status)', async () => {
    const s = (await api().get('/api/v1/seller/orders/summary').set(bearer(t.gadgets)).expect(200)).body;
    expect(s.orders.new).toBeGreaterThanOrEqual(1);
    expect(s.newestNew).toMatchObject({ id: expect.any(String) });
    expect(s.products.live).toBeGreaterThan(0);
    expect(s.products).toHaveProperty('lowStock');
    await api().get('/api/v1/seller/orders/summary').set(bearer(t.courier)).expect(403);
  });

  it('the seller prints the label + packing list for their own parcel; another seller cannot', async () => {
    const res = await binary(api().get(`/api/v1/seller/orders/${t.so}/label.pdf`).set(bearer(t.gadgets))).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const pdf = pdfBody(res);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    await binary(api().get(`/api/v1/seller/labels.pdf`).query({ ids: t.so }).set(bearer(t.gadgets))).expect(200);
    await api().get(`/api/v1/seller/orders/${t.so}/label.pdf`).set(bearer(t.home)).expect(404);
    await api().get(`/api/v1/seller/labels.pdf`).set(bearer(t.gadgets)).expect(400);
    // staff can print it too (they hand it to a driver)
    await binary(api().get(`/api/v1/admin/orders/shipments/${t.so}/label.pdf`).set(bearer(t.admin))).expect(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'documents.labels', entityId: t.so }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
  });

  it('packed and ready: the driver scans the label QR to pick it up; a second scan says it is already picked up', async () => {
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/seller/orders/${t.so}/status`).set(bearer(t.gadgets)).send({ status }).expect(200);
    let d = null;
    for (let i = 0; i < 50 && !d; i++) {
      d = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: t.so } });
      if (!d) await new Promise((r) => setTimeout(r, 100));
    }
    if (!d) throw new Error('no delivery record');
    // not assigned to this driver yet: not theirs to take
    await api().post('/api/v1/courier/jobs/scan').set(bearer(t.courier)).send({ code: `FMXS:${t.so}` }).expect(404);
    await api().post(`/api/v1/admin/deliveries/${d.id}/assign`).set(bearer(t.admin)).send({ courierUserId: t.courierId }).expect(200);

    const first = (await api().post('/api/v1/courier/jobs/scan').set(bearer(t.courier)).send({ code: `FMXS:${t.so}` }).expect(200)).body;
    expect(first).toMatchObject({ id: d.id, orderNumber: t.orderNumber, status: 'PICKED_UP', pickedUp: true });
    expect((await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('PICKED_UP');
    const again = (await api().post('/api/v1/courier/jobs/scan').set(bearer(t.courier)).send({ code: `FMXS:${t.so}` }).expect(200)).body;
    expect(again).toMatchObject({ pickedUp: false, status: 'PICKED_UP' });

    await api().post('/api/v1/courier/jobs/scan').set(bearer(t.courier)).send({ code: 'hello' }).expect(400);
    await api().post('/api/v1/courier/jobs/scan').set(bearer(t.courier)).send({ code: 'FMXS:00000000-0000-4000-8000-000000000000' }).expect(404);
    await api().post('/api/v1/courier/jobs/scan').set(bearer(t.gadgets)).send({ code: `FMXS:${t.so}` }).expect(403);
  });

  it('a new seller gets the 7-day return window; the weekly payout run asks once for every seller\'s ready money', async () => {
    const fresh = await api().post('/api/v1/auth/register').send({ fullName: 'P26 Seller', email: `p26.seller.${run}@example.com`, password: 'P26-Pass-2026!', countryCode: 'QA', locale: 'en' }).expect(201);
    await api().post('/api/v1/seller/apply').set(bearer(fresh.body.accessToken)).send({ businessName: `P26 Trading ${run}`, storeName: `P26 Shop ${run}`, contactEmail: `p26.seller.${run}@example.com`, contactPhone: '+97455526260' }).expect(201);
    const seller = await prisma.seller.findFirstOrThrow({ where: { contactEmail: `p26.seller.${run}@example.com` }, select: { returnWindowDays: true } });
    expect(seller.returnWindowDays).toBe(7);

    const start = new Date();
    const svc = app.get(PayoutsService);
    try {
      const first = await svc.weeklyRequests();
      const made = await prisma.sellerPayout.count({ where: { requestedAt: { gte: start }, status: 'REQUESTED' } });
      expect(made).toBe(first.requested);
      const again = await svc.weeklyRequests();
      expect(again.requested).toBe(0); // a seller with an open request is not asked twice
    } finally {
      await prisma.sellerPayout.deleteMany({ where: { requestedAt: { gte: start }, status: 'REQUESTED' } });
    }
  });
});
