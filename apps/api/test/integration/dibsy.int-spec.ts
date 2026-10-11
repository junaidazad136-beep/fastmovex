/**
 * Card payments through Dibsy, on a real database, against a local stand-in for the Dibsy API (same request and
 * response shapes as Dibsy's own plugin). Proves: hosted redirect, webhook looked up (never trusted), replay ignored,
 * lost webhook recovered when the customer returns and before expiry, amount mismatch refused, failure restores the
 * cart, refunds go to Dibsy, and the return address can only be our website.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import type { PrismaService as PrismaServiceType } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toUpperCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const RETURN = 'http://localhost:3000/en/checkout/return';

interface FakePayment { id: string; status: string; amount: { value: string; currency: string }; metadata: Record<string, unknown>; method?: string }

describe('Dibsy card payments — real database, stand-in Dibsy API', () => {
  let app: INestApplication;
  let prisma: PrismaServiceType;
  let server: http.Server;
  const env = { ...process.env };
  const payments = new Map<string, FakePayment>();
  const refunds: { paymentId: string; body: unknown }[] = [];
  const seen: { auth?: string; version?: string }[] = [];
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  async function order(qty = 1, returnUrl = RETURN) {
    await api().delete('/api/v1/cart').set(bearer(s.customer));
    await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: s.variant, quantity: qty }).expect(201);
    return api().post('/api/v1/checkout').set(bearer(s.customer)).set('Idempotency-Key', `dib-${run}-${randomBytes(4).toString('hex')}`)
      .send({ addressId: s.address, paymentMethod: 'CARD', returnUrl });
  }
  const webhook = (body: unknown) => api().post('/api/v1/payments/webhook/dibsy').send(body as object);
  const orderRow = (orderNumber: string) => prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { payments: true } });

  beforeAll(async () => {
    // Stand-in for https://api.dibsy.one/v2
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, version: req.headers['dibsy-version'] as string });
        const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        const url = req.url ?? '';
        if (req.headers.authorization !== 'Bearer sk_test_jovia_integration_key') return send(401, { status: 401, details: 'bad key' });
        if (req.method === 'POST' && url === '/v2/payments') {
          const b = JSON.parse(data) as { amount: FakePayment['amount']; metadata: Record<string, unknown> };
          const id = `pt_${randomBytes(6).toString('hex')}`;
          payments.set(id, { id, status: 'open', amount: b.amount, metadata: b.metadata });
          return send(201, { id, status: 'open', amount: b.amount, _links: { checkout: { href: `https://pay.dibsy.test/${id}` } } });
        }
        const m = /^\/v2\/payments\/([\w-]+)(\/refunds)?$/.exec(url);
        const p = m ? payments.get(m[1]) : undefined;
        if (m && !p) return send(404, { status: 404, details: 'Payment not found' });
        if (m && req.method === 'GET' && !m[2]) return send(200, p);
        if (m && req.method === 'POST' && m[2]) {
          refunds.push({ paymentId: m[1], body: JSON.parse(data) });
          return send(201, { id: `re_${randomBytes(4).toString('hex')}`, status: 'refunded' });
        }
        send(404, { status: 404, details: 'no route' });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.DIBSY_SECRET_KEY = 'sk_test_jovia_integration_key';
    process.env.DIBSY_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2`;
    process.env.API_PUBLIC_URL = 'https://api.jovia.test';

    // Imported only now, so the configuration is read with the Dibsy settings above.
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.setup');
    const { NotificationsService } = await import('../../src/notifications/notifications.service');
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);

    s.admin = await login('admin@demo.jovia.test');
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Dibsy Lamp ${run}`, titleAr: 'مصباح', categoryId: cat.id, variants: [{ sku: `DL-${run}`, priceMinor: '12950', initialStock: 50 }],
    }).expect(201);
    s.product = p.body.id;
    s.variant = p.body.variants[0].id;
    await api().post(`/api/v1/admin/products/${s.product}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${s.product}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);

    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Card Buyer', email: `dibsy.${run.toLowerCase()}@jovia.test`, password: 'Buyer-Pass-123' }).expect(201);
    s.customer = reg.body.accessToken;
    s.address = (await api().post('/api/v1/addresses').set(bearer(s.customer)).send({ recipientName: 'Buyer', phone: '+97455500033', city: 'Doha', zone: '60', street: '800', building: '3' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
    await new Promise<void>((r) => server.close(() => r()));
    process.env = env;
  });

  it('the shop offers one card option, served by Dibsy (not the sandbox)', async () => {
    const markets = await api().get('/api/v1/markets').expect(200);
    const qa = markets.body.find((m: { code: string }) => m.code === 'QA');
    expect(qa).toMatchObject({ cardProvider: 'dibsy', testPayments: false });
  });

  it('checkout creates a Dibsy payment and sends the customer to its page; the order waits for the money', async () => {
    const res = await order(1);
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ status: 'PENDING', redirectUrl: expect.stringMatching(/^https:\/\/pay\.dibsy\.test\/pt_/) });
    s.order1 = res.body.orderNumber;
    const o = await orderRow(s.order1);
    expect(o.status).toBe('PENDING');
    expect(o.payments[0]).toMatchObject({ provider: 'dibsy', status: 'PENDING' });
    s.ref1 = o.payments[0].providerRef!;
    const fake = payments.get(s.ref1)!;
    expect(fake.amount).toEqual({ value: '129.50', currency: 'QAR' });
    expect(fake.metadata).toMatchObject({ order_id: o.id, order_number: s.order1 });
    expect(seen.every((x) => x.version === '2022-07-10')).toBe(true);
  });

  it('a forged "succeeded" webhook changes nothing: Dibsy itself still says open', async () => {
    await webhook({ id: s.ref1, status: 'succeeded' }).expect(200);
    expect((await orderRow(s.order1)).status).toBe('PENDING');
    await webhook({ id: '../../admin' }).expect(400);
    await webhook({ id: 'pt_doesnotexist' }).expect(400);
  });

  it('the real payment confirms the order and posts the ledger; a replay is ignored', async () => {
    payments.get(s.ref1)!.status = 'succeeded';
    payments.get(s.ref1)!.method = 'applepay';
    await webhook({ id: s.ref1 }).expect(200);
    const o = await orderRow(s.order1);
    expect(o.status).toBe('CONFIRMED');
    expect(o.payments[0].status).toBe('CAPTURED');
    const again = await webhook({ id: s.ref1 }).expect(200);
    expect(again.body).toEqual({ duplicate: true });
    const tx = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `order_captured_${o.id}` } });
    expect(tx).toBe(1);
    const sum = await prisma.ledgerEntry.aggregate({ _sum: { amountMinor: true } });
    expect(sum._sum.amountMinor ?? 0n).toBe(0n);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: o.payments[0].id, action: 'payment.captured' } });
    expect(audit?.after).toMatchObject({ paidWith: 'applepay' });
  });

  it('webhook lost: the order is confirmed when the customer opens it after paying', async () => {
    const res = await order(1);
    s.order2 = res.body.orderNumber;
    const ref = (await orderRow(s.order2)).payments[0].providerRef!;
    payments.get(ref)!.status = 'succeeded';
    const view = await api().get(`/api/v1/orders/${s.order2}`).set(bearer(s.customer)).expect(200);
    expect(view.body.status).toBe('CONFIRMED');
  });

  it('webhook lost and customer gone: the expiry job asks Dibsy first and keeps a paid order', async () => {
    const paid = await order(1);
    const unpaid = await order(1);
    const [p, u] = [await orderRow(paid.body.orderNumber), await orderRow(unpaid.body.orderNumber)];
    payments.get(p.payments[0].providerRef!)!.status = 'succeeded';
    const old = new Date(Date.now() - 2 * 3600_000);
    await prisma.order.updateMany({ where: { id: { in: [p.id, u.id] } }, data: { placedAt: old } });
    const { UnpaidOrdersService } = await import('../../src/orders/unpaid-orders.service');
    await app.get(UnpaidOrdersService).expireStale();
    expect((await orderRow(p.orderNumber)).status).toBe('CONFIRMED');
    expect((await orderRow(u.orderNumber)).status).toBe('CANCELLED');
  });

  it('an answer about a different amount is refused and recorded', async () => {
    const res = await order(1);
    const o = await orderRow(res.body.orderNumber);
    const fake = payments.get(o.payments[0].providerRef!)!;
    fake.status = 'succeeded';
    fake.amount = { value: '1.00', currency: 'QAR' };
    await webhook({ id: fake.id }).expect(200);
    expect((await orderRow(o.orderNumber)).status).toBe('PENDING');
    expect(await prisma.auditLog.count({ where: { entityId: o.payments[0].id, action: 'payment.mismatch' } })).toBe(1);
  });

  it('a failed payment cancels the order, returns the stock and puts the items back in the cart', async () => {
    const before = await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } });
    const res = await order(2);
    const o = await orderRow(res.body.orderNumber);
    payments.get(o.payments[0].providerRef!)!.status = 'failed';
    await webhook({ id: o.payments[0].providerRef }).expect(200);
    expect((await orderRow(o.orderNumber)).status).toBe('CANCELLED');
    const after = await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } });
    expect(after.reserved).toBe(before.reserved);
    const cart = await api().get('/api/v1/cart').set(bearer(s.customer)).expect(200);
    expect(JSON.stringify(cart.body)).toContain(s.variant);
  });

  it('the payment page can only send the customer back to our website', async () => {
    const count = await prisma.order.count({ where: { user: { email: `dibsy.${run.toLowerCase()}@jovia.test` } } });
    const evil = await order(1, 'https://evil.example/steal');
    expect(evil.status).toBe(400);
    const none = await api().post('/api/v1/checkout').set(bearer(s.customer)).set('Idempotency-Key', `dib-${run}-none`).send({ addressId: s.address, paymentMethod: 'CARD' });
    expect(none.status).toBe(400);
    expect(await prisma.order.count({ where: { user: { email: `dibsy.${run.toLowerCase()}@jovia.test` } } })).toBe(count);
  });

  it('finance refunds through Dibsy: the exact amount goes back and the ledger stays balanced', async () => {
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: s.order1 }, include: { sellerOrders: true } });
    const finance = await login('finance@demo.jovia.test');
    const r = await api().post('/api/v1/admin/refunds').set(bearer(finance))
      .send({ orderNumber: s.order1, sellerOrderId: o.sellerOrders[0].id, amountMinor: '5000', reason: 'Goodwill refund for a late delivery' });
    expect([200, 201]).toContain(r.status);
    // four-eyes: the person who created the refund cannot approve it
    await api().post(`/api/v1/admin/refunds/${r.body.id}/approve`).set(bearer(finance)).expect(403);
    const finance2 = await login('finance2@demo.jovia.test');
    const approve = await api().post(`/api/v1/admin/refunds/${r.body.id}/approve`).set(bearer(finance2));
    expect(approve.status).toBe(200);
    expect(refunds.at(-1)).toEqual({ paymentId: s.ref1, body: { amount: '50.00', description: 'Goodwill refund for a late delivery' } });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('SUCCEEDED');
    const sum = await prisma.ledgerEntry.aggregate({ _sum: { amountMinor: true } });
    expect(sum._sum.amountMinor ?? 0n).toBe(0n);
  });
});
