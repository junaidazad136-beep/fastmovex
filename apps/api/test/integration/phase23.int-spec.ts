/**
 * PHASE 23 on a real database: sign in with Google (token signed by a key server this test runs), browser
 * notifications, "Buy again", staff adding items before dispatch, promo codes on phone orders, the driver's ETA on
 * the customer's order page, and audit entries for staff changes that had none.
 */
import { GOOGLE_CLIENT, JWKS_PORT } from './phase23-env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { createServer, Server } from 'http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { WebPushService } from '../../src/notifications/web-push';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9746${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Phase 23 — social sign-in, browser push, buy again, add items, phone promo codes, ETA, audit (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwks: Server;
  let signKey: CryptoKey;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const idOf = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } })).id;
  const googleToken = (sub: string, claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'p23' }).setIssuer('https://accounts.google.com').setAudience(GOOGLE_CLIENT).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(signKey);

  async function customer(name = 'Noor Again') {
    const email = `p23.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: name, email, password: 'Buyer-Pass-123' }).expect(201);
    const t = reg.body.accessToken as string;
    const a = await api().post('/api/v1/addresses').set(bearer(t)).send({ recipientName: name, phone: phone(), countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '3', isDefault: true, lat: 25.2854, lng: 51.531 }).expect(201);
    return { token: t, address: a.body.id as string, id: await idOf(email), email };
  }
  async function order(c: { token: string; address: string }, lines: { variant: string; quantity: number }[], paymentMethod: 'COD' | 'CARD' = 'COD') {
    await api().delete('/api/v1/cart').set(bearer(c.token));
    for (const l of lines) await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: l.variant, quantity: l.quantity }).expect(201);
    const r = await api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `p23-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: c.address, paymentMethod }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: r.body.orderNumber }, include: { sellerOrders: true, payments: true } });
    return { orderNumber: o.orderNumber, id: o.id, so: o.sellerOrders[0].id, total: o.totalMinor };
  }
  async function product(title: string, priceMinor: string, stock = 100) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title: `${title} ${run}`, titleAr: `${title} ${run}`, categoryId: cat.id, variants: [{ sku: `P23-${title.replace(/\W/g, '').slice(0, 4).toUpperCase()}-${run}`, priceMinor, initialStock: stock }] }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    return { variant: p.body.variants[0].id as string, product: p.body.id as string };
  }
  const reserved = async (variantId: string) => (await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reserved;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    signKey = pair.privateKey as CryptoKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'p23', alg: 'RS256', use: 'sig' };
    jwks = createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
    await new Promise<void>((ok) => jwks.listen(JWKS_PORT, '127.0.0.1', ok));

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 5, driverCashLimitMinor: null });
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined as never);
    s.admin = await login('admin@demo.fastmovex.test');
    s.ops = await login('ops@demo.fastmovex.test');
    s.finance = await login('finance@demo.fastmovex.test');
    s.courier = await login('courier@demo.fastmovex.test');
    s.courierId = await idOf('courier@demo.fastmovex.test');
    const a = await product('Again Cup', '3000');
    const b = await product('Again Plate', '2000');
    const c = await product('Extra Spoon', '500');
    Object.assign(s, { cup: a.variant, cupProduct: a.product, plate: b.variant, plateProduct: b.product, spoon: c.variant });
  });

  afterAll(async () => {
    await prisma?.coupon.deleteMany({ where: { code: { startsWith: `P23${run.toUpperCase()}` } } }).catch(() => undefined);
    await restoreCod?.();
    await sleep(300);
    await app?.close();
    jwks?.closeAllConnections();
    await new Promise<void>((ok) => jwks?.close(() => ok()));
  });

  it('sign in with Google: a new account, the same account again, a verified email links, staff and admin panel refused', async () => {
    expect((await api().get('/api/v1/auth/social/providers').expect(200)).body).toEqual({ google: GOOGLE_CLIENT, apple: null });
    const sub = `g-${run}`;
    const email = `social.${run}@example.com`;
    const first = await api().post('/api/v1/auth/social').send({ provider: 'GOOGLE', idToken: await googleToken(sub, { email, email_verified: true, name: 'Hamad Social', nonce: 'nonce-one-1' }), nonce: 'nonce-one-1', locale: 'ar' }).expect(200);
    expect(first.body).toMatchObject({ created: true });
    expect(String(first.headers['set-cookie'])).toMatch(/fmx_rt=/);
    const me = (await api().get('/api/v1/auth/me').set(bearer(first.body.accessToken)).expect(200)).body;
    expect(me).toMatchObject({ fullName: 'Hamad Social', email, hasPassword: false, signIns: ['GOOGLE'], locale: 'ar' });
    expect(me.emailVerifiedAt).toBeTruthy();
    const again = await api().post('/api/v1/auth/social').send({ provider: 'GOOGLE', idToken: await googleToken(sub, { email, email_verified: true, nonce: 'nonce-two-2' }), nonce: 'nonce-two-2' }).expect(200);
    expect(again.body.created).toBe(false);
    // the only way in cannot be removed
    expect((await api().delete('/api/v1/auth/social/google').set(bearer(again.body.accessToken)).expect(400)).body.reason).toBe('LAST_SIGN_IN');
    // replayed token with another nonce, or none
    await api().post('/api/v1/auth/social').send({ provider: 'GOOGLE', idToken: await googleToken(sub, { email, email_verified: true, nonce: 'nonce-three-3' }), nonce: 'nonce-other-x' }).expect(401);
    // an existing password account with the same confirmed email gets Google linked
    const c = await customer();
    const linked = await api().post('/api/v1/auth/social').send({ provider: 'GOOGLE', idToken: await googleToken(`g2-${run}`, { email: c.email, email_verified: true }) }).expect(200);
    expect(linked.body.created).toBe(false);
    expect((await api().get('/api/v1/auth/social').set(bearer(c.token)).expect(200)).body).toEqual([expect.objectContaining({ provider: 'GOOGLE', email: c.email })]);
    expect((await api().delete('/api/v1/auth/social/google').set(bearer(c.token)).expect(200)).body).toEqual([]); // has a password: fine
    // unconfirmed email: no account; staff email: refused; the admin panel never accepts it
    expect((await api().post('/api/v1/auth/social').send({ provider: 'GOOGLE', idToken: await googleToken(`g3-${run}`, { email: `x.${run}@example.com`, email_verified: false }) }).expect(400)).body.reason).toBe('SOCIAL_NO_EMAIL');
    expect((await api().post('/api/v1/auth/social').send({ provider: 'GOOGLE', idToken: await googleToken(`g4-${run}`, { email: 'admin@demo.fastmovex.test', email_verified: true }) }).expect(403)).body.reason).toBe('STAFF_ACCOUNT');
    await api().post('/api/v1/auth/social').set('x-client-type', 'admin').send({ provider: 'GOOGLE', idToken: await googleToken(sub, { email, email_verified: true }) }).expect(403);
    await api().post('/api/v1/auth/social').send({ provider: 'APPLE', idToken: 'x'.repeat(40) }).expect(400); // Apple not set up
    const audit = await prisma.auditLog.findMany({ where: { entityId: me.id, action: { in: ['auth.social_signup', 'auth.social_linked'] } } });
    expect(audit.map((x) => x.action)).toEqual(['auth.social_signup']);
  });

  it('browser notifications: subscribe (https only), order updates go to the browser, unsubscribe', async () => {
    const c = await customer('Push Person');
    const cfg = (await api().get('/api/v1/me/push').set(bearer(c.token)).expect(200)).body;
    expect(cfg).toMatchObject({ enabled: true, browsers: 0 });
    expect(cfg.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    await api().post('/api/v1/me/push/subscriptions').set(bearer(c.token)).send({ endpoint: 'http://push.example.test/x', keys }).expect(400);
    const endpoint = `https://push.example.test/send/${run}`;
    await api().post('/api/v1/me/push/subscriptions').set(bearer(c.token)).send({ endpoint, keys }).expect(201);
    expect((await api().get('/api/v1/me/push').set(bearer(c.token)).expect(200)).body.browsers).toBe(1);
    const sent = jest.spyOn(app.get(WebPushService), 'sendToUser').mockResolvedValue(1);
    const channels = await app.get(NotificationsService).notify(c.id, 'ORDER_CHANGED', { orderNumber: 'FMX-TEST', summary: 'x', moneyLine: '' }, { orderNumber: 'FMX-TEST' });
    expect(channels).toContain('PUSH');
    await app.get(NotificationsService).processQueue();
    expect(sent).toHaveBeenCalledWith(c.id, expect.objectContaining({ title: expect.stringContaining('FMX-TEST') }), 'en');
    expect(await prisma.notification.findFirst({ where: { userId: c.id, channel: 'PUSH' }, select: { status: true } })).toEqual({ status: 'SENT' });
    sent.mockRestore();
    await api().post('/api/v1/me/push/subscriptions/remove').set(bearer(c.token)).send({ endpoint }).expect(200);
    expect(await prisma.webPushSubscription.count({ where: { userId: c.id } })).toBe(0);
  });

  it('buy again: what is still sold goes back in the cart at today’s price; the rest is listed', async () => {
    const c = await customer();
    const o = await order(c, [{ variant: s.cup, quantity: 2 }, { variant: s.plate, quantity: 1 }]);
    // the plate is no longer sold; the cup costs more today
    await api().post(`/api/v1/admin/products/${s.plateProduct}/status`).set(bearer(s.admin)).send({ status: 'DRAFT' }).expect(200);
    await prisma.productVariant.update({ where: { id: s.cup }, data: { priceMinor: 3500n } });
    const r = (await api().post(`/api/v1/orders/${o.orderNumber}/buy-again`).set(bearer(c.token)).expect(200)).body;
    expect(r.added).toEqual([expect.objectContaining({ variantId: s.cup, quantity: 2 })]);
    expect(r.skipped).toEqual([expect.objectContaining({ variantId: s.plate, reason: 'UNAVAILABLE' })]);
    expect(r.cart.totals.subtotalMinor).toBe('7000');
    // someone else's order: not found
    const other = await customer();
    await api().post(`/api/v1/orders/${o.orderNumber}/buy-again`).set(bearer(other.token)).expect(404);
    await prisma.productVariant.update({ where: { id: s.cup }, data: { priceMinor: 3000n } });
    await api().post(`/api/v1/admin/products/${s.plateProduct}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('staff add an item before dispatch (cash orders): stock, totals, cash to collect, record, message', async () => {
    const c = await customer();
    const o = await order(c, [{ variant: s.cup, quantity: 1 }]);
    const before = await reserved(s.spoon);
    await api().post(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.finance)).send({ variantId: s.spoon, quantity: 2, reason: 'Customer called' }).expect(403);
    await api().post(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ variantId: s.spoon, quantity: 2, reason: 'x' }).expect(400);
    const found = (await api().get(`/api/v1/admin/orders/${o.orderNumber}/addable-products`).query({ q: `Extra Spoon ${run}` }).set(bearer(s.ops)).expect(200)).body;
    expect(found[0]).toMatchObject({ variantId: s.spoon, priceMinor: '500' });
    const r = await api().post(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ variantId: s.spoon, quantity: 2, reason: 'Customer called: two spoons too' }).expect(201);
    expect(r.body.amountMinor).toBe('1000');
    expect(await reserved(s.spoon)).toBe(before + 2);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true, items: true, changes: true, sellerOrders: true } });
    expect(after.totalMinor).toBe(o.total + 1000n);
    expect(after.payments[0].amountMinor).toBe(after.totalMinor);
    expect(after.items).toHaveLength(2);
    expect(after.sellerOrders[0].subtotalMinor).toBe(4000n);
    expect(after.changes).toEqual([expect.objectContaining({ kind: 'ADDED', byRole: 'STAFF', amountMinor: 1000n })]);
    expect(await prisma.auditLog.count({ where: { entityId: o.id, action: 'order.items_added' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: c.id, type: 'ORDER_CHANGED', body: { contains: 'more on delivery' } } })).toBeGreaterThan(0);
    // the customer sees it in the order's history
    const seen = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(seen.changes).toEqual([expect.objectContaining({ kind: 'ADDED', amountMinor: '1000' })]);
    // card orders: refused (place a new order instead)
    const paid = await order(c, [{ variant: s.cup, quantity: 1 }], 'CARD');
    await prisma.sellerOrder.update({ where: { id: paid.so }, data: { status: 'CONFIRMED' } });
    expect((await api().post(`/api/v1/admin/orders/${paid.orderNumber}/items`).set(bearer(s.ops)).send({ variantId: s.spoon, quantity: 1, reason: 'Customer called again' }).expect(409)).body.reason).toBe('ADD_NEEDS_COD');
    // more than the stock: refused, nothing reserved
    const mid = await reserved(s.spoon);
    expect((await api().post(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ variantId: s.spoon, quantity: 99, reason: 'Customer wants many' }).expect(409)).body.reason).toBe('OUT_OF_STOCK');
    expect(await reserved(s.spoon)).toBe(mid);
    // once the driver has it: no more changes
    await prisma.sellerOrder.update({ where: { id: o.so }, data: { status: 'OUT_FOR_DELIVERY' } });
    expect((await api().post(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ variantId: s.spoon, quantity: 1, reason: 'Too late now' }).expect(409)).body.reason).toBe('NOT_EDITABLE');
  });

  it('phone orders take a promo code, judged for that customer (a new caller counts as new)', async () => {
    const code = `P23${run.toUpperCase()}`;
    await prisma.coupon.create({ data: { code, countryCode: 'QA', type: 'PERCENTAGE', valueBps: 1000, firstOrderOnly: true, startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 86_400_000), perUserLimit: 1 } });
    const caller = phone();
    const body = {
      customer: { fullName: 'Promo Caller', phone: caller },
      items: [{ variantId: s.cup, quantity: 2 }],
      address: { recipientName: 'Promo Caller', phone: caller, countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '9' },
      couponCode: code.toLowerCase(),
    };
    const q = (await api().post('/api/v1/admin/phone-orders/quote').set(bearer(s.ops)).send(body).expect(200)).body;
    expect(q.cart.coupon).toMatchObject({ code, applied: true, discountMinor: '600' });
    const placed = (await api().post('/api/v1/admin/phone-orders').set(bearer(s.ops)).set('Idempotency-Key', `p23-coupon-${run}`).send(body).expect(201)).body;
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: placed.orderNumber }, include: { coupon: true } });
    expect(o.discountMinor).toBe(600n);
    expect(o.coupon?.code).toBe(code);
    expect(await prisma.couponRedemption.count({ where: { orderId: o.id, userId: o.userId } })).toBe(1);
    // the same caller again: their one use is gone
    const again = await api().post('/api/v1/admin/phone-orders/quote').set(bearer(s.ops)).send({ ...body, customer: { phone: caller } }).expect(400);
    expect(again.body.reason).toMatch(/PER_USER_LIMIT|FIRST_ORDER_ONLY/);
    await api().post('/api/v1/admin/phone-orders/quote').set(bearer(s.ops)).send({ ...body, couponCode: 'NOPE-NOT-REAL' }).expect(400);
  });

  it('out for delivery: the customer sees when the driver should arrive', async () => {
    const c = await customer();
    const o = await order(c, [{ variant: s.cup, quantity: 1 }]);
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${o.so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    let d = null;
    for (let i = 0; i < 50 && !d; i++) { d = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: o.so } }); if (!d) await sleep(100); }
    await api().post(`/api/v1/admin/deliveries/${d!.id}/assign`).set(bearer(s.admin)).send({ courierUserId: s.courierId }).expect(200);
    await api().post(`/api/v1/courier/jobs/${d!.id}/pickup`).set(bearer(s.courier)).expect(200);
    const noEta = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(noEta.sellerOrders[0].delivery.eta ?? null).toBeNull();
    await api().post(`/api/v1/courier/jobs/${d!.id}/out-for-delivery`).set(bearer(s.courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${d!.id}/location`).set(bearer(s.courier)).send({ lat: 25.3154, lng: 51.531 }).expect(200);
    const view = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    const eta = view.sellerOrders[0].delivery.eta;
    expect(eta.minutes).toBeGreaterThanOrEqual(11);
    expect(eta.stopsBefore).toBeGreaterThanOrEqual(0);
    expect(new Date(eta.at).getTime()).toBeGreaterThan(Date.now());
    expect(view.sellerOrders[0].delivery.courierUserId).toBeUndefined(); // internal ids stay hidden
    // a failed attempt now leaves an audit entry
    await api().post(`/api/v1/courier/jobs/${d!.id}/fail`).set(bearer(s.courier)).field('reason', 'Customer not answering').expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: d!.id, action: 'delivery.failed' } })).toBe(1);
  });

  it('audit: images, variant changes and stock adjustments are recorded', async () => {
    const img = await api().post(`/api/v1/admin/products/${s.cupProduct}/images`).set(bearer(s.admin)).attach('file', PNG, 'second.png').expect(201);
    await api().delete(`/api/v1/admin/images/${img.body.id}`).set(bearer(s.admin)).expect(204);
    await api().patch(`/api/v1/admin/variants/${s.spoon}`).set(bearer(s.admin)).send({ barcode: `629${Date.now().toString().slice(-10)}` }).expect(200);
    await api().post(`/api/v1/admin/variants/${s.spoon}/stock`).set(bearer(s.admin)).send({ delta: 5, reason: 'RESTOCK' }).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ entityId: s.cupProduct }, { entityId: s.spoon }], createdAt: { gte: new Date(Date.now() - 60_000) } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['product.image_add', 'product.image_remove', 'variant.update', 'inventory.adjust']));
  });
});
