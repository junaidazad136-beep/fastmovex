/**
 * END-TO-END MARKETPLACE FLOW against a real PostgreSQL, real storage and the real application.
 * Nothing is mocked except the outgoing email/SMS call (captured so the test can read one-time codes).
 *
 * Needs: migrations applied, `npm run db:seed` and `npm run db:seed:demo` (demo admin, finance, ops,
 * courier and the "Doha Gadgets Hub" seller are used). Every run creates fresh customers and a fresh
 * seller, so it can be repeated on the same database.
 *
 *   npm run test:int
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const phone = () => `+9745${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

describe('FastMoveX marketplace — full flow on a real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sent: { channel: string; to: string; body: string }[] = [];

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').set('X-Client-Type', 'mobile').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body as { accessToken: string; refreshToken: string };
  }

  async function register(email: string, password = 'Customer-Pass-1') {
    const res = await api().post('/api/v1/auth/register').set('X-Client-Type', 'mobile').send({ fullName: 'Flow Tester', email, phone: phone(), password });
    expect(res.status).toBe(201);
    return res.body as { accessToken: string; refreshToken: string };
  }

  async function codeSentTo(to: string, timeoutMs = 3000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const m = [...sent].reverse().find((s) => s.to === to);
      if (m) return m.body.match(/\d{6}/)![0];
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No code was sent to ${to}`);
  }

  async function until<T>(fn: () => Promise<T | undefined | null | false>, label: string, timeoutMs = 5000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = await fn();
      if (v) return v as T;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async function ledgerTotal() {
    const agg = await prisma.ledgerEntry.aggregate({ _sum: { amountMinor: true } });
    return agg._sum.amountMinor ?? 0n;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const notifications = app.get(NotificationsService);
    jest.spyOn(notifications, 'sendDirect').mockImplementation(async (channel, to, _title, body) => {
      sent.push({ channel, to, body });
    });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300)); // let background notification writes finish
    await app?.close();
  });

  // Shared state across the ordered steps below
  const s: Record<string, string> = {};

  // ---------------------------------------------------------------- accounts

  it('1. customer registers, verifies email, forgets and resets password', async () => {
    const email = `flow.customer.${run}@jovia.test`;
    const t = await register(email);
    s.customer = t.accessToken;

    // verification code (the welcome code may already be on its way; request explicitly after cooldown-safe check)
    const welcome = await codeSentTo(email).catch(() => null);
    const code = welcome ?? (await (async () => {
      await api().post('/api/v1/auth/verify/request').set(bearer(s.customer)).send({ channel: 'email' }).expect(202);
      return codeSentTo(email);
    })());
    await api().post('/api/v1/auth/verify/confirm').set(bearer(s.customer)).send({ channel: 'email', code: '000000' === code ? '111111' : '000000' }).expect(400);
    await api().post('/api/v1/auth/verify/confirm').set(bearer(s.customer)).send({ channel: 'email', code }).expect(200);
    const me = await api().get('/api/v1/auth/me').set(bearer(s.customer)).expect(200);
    expect(me.body.emailVerifiedAt).toBeTruthy();

    // forgot / reset (a fresh purpose, so no cooldown clash)
    sent.length = 0;
    await api().post('/api/v1/auth/password/forgot').send({ identifier: email }).expect(202);
    const resetCode = await codeSentTo(email);
    await api().post('/api/v1/auth/password/reset').send({ identifier: email, code: resetCode, newPassword: 'Brand-New-Pass-2' }).expect(204);
    await api().post('/api/v1/auth/password/reset').send({ identifier: email, code: resetCode, newPassword: 'Another-Pass-3' }).expect(400); // single use
    await api().post('/api/v1/auth/login').send({ identifier: email, password: 'Customer-Pass-1' }).expect(401);
    s.customer = (await login(email, 'Brand-New-Pass-2')).accessToken;
    // the old session was revoked by the reset
    await api().post('/api/v1/auth/refresh').set('X-Client-Type', 'mobile').send({ refreshToken: t.refreshToken }).expect(401);
  });

  it('2. unknown accounts get the same forgot-password answer and no code', async () => {
    sent.length = 0;
    const res = await api().post('/api/v1/auth/password/forgot').send({ identifier: `nobody.${run}@jovia.test` }).expect(202);
    expect(res.body.message).toContain('If an account exists');
    await new Promise((r) => setTimeout(r, 300));
    expect(sent).toHaveLength(0);
  });

  // ------------------------------------------------------------ seller onboarding

  it('3. a new seller applies, uploads documents and bank details, and is approved by admin', async () => {
    const email = `flow.seller.${run}@jovia.test`;
    const t = await register(email, 'Seller-Pass-123');
    const apply = await api().post('/api/v1/seller/apply').set(bearer(t.accessToken))
      .send({ businessName: `Flow Traders ${run} WLL`, storeName: `Flow Store ${run}`, contactEmail: email, contactPhone: phone(), commercialRegNo: `CR-${run}` }).expect(201);
    expect(apply.body.requiresTokenRefresh).toBe(true);
    s.sellerId = apply.body.id;

    // before refresh the token has no SELLER role
    await api().get('/api/v1/seller/me').set(bearer(t.accessToken)).expect(403);
    const refreshed = await api().post('/api/v1/auth/refresh').set('X-Client-Type', 'mobile').send({ refreshToken: t.refreshToken }).expect(200);
    s.seller = refreshed.body.accessToken;

    // pending sellers cannot list products yet
    await api().get('/api/v1/seller/products').set(bearer(s.seller)).expect(403);
    // submitting too early lists what is missing
    const early = await api().post('/api/v1/seller/me/submit').set(bearer(s.seller)).expect(400);
    expect(early.body.missing.length).toBeGreaterThan(0);

    await api().put('/api/v1/seller/me/bank').set(bearer(s.seller)).send({ bankName: 'QNB', accountHolder: 'Flow Traders', iban: 'QA00XXXX0000000000000000000000' }).expect(400);
    const bank = await api().put('/api/v1/seller/me/bank').set(bearer(s.seller)).send({ bankName: 'QNB', accountHolder: 'Flow Traders', iban: 'QA58 DOHB 0000 1234 5678 90AB CDEF G' }).expect(200);
    expect(bank.body).toEqual({ bankName: 'QNB', accountHolder: 'Flow Traders', ibanLast4: 'DEFG' });
    const raw = await prisma.seller.findUniqueOrThrow({ where: { id: s.sellerId }, select: { ibanEncrypted: true } });
    expect(raw.ibanEncrypted).not.toContain('DOHB'); // encrypted at rest

    await api().post('/api/v1/seller/me/documents').set(bearer(s.seller)).field('type', 'COMMERCIAL_REGISTRATION').attach('file', Buffer.from('<svg onload=alert(1)>'), 'cr.pdf').expect(400);
    await api().post('/api/v1/seller/me/documents').set(bearer(s.seller)).field('type', 'COMMERCIAL_REGISTRATION').attach('file', PDF, 'cr.pdf').expect(201);
    const submit = await api().post('/api/v1/seller/me/submit').set(bearer(s.seller)).expect(200);
    expect(submit.body.status).toBe('UNDER_REVIEW');

    s.admin = (await login('admin@demo.jovia.test')).accessToken;
    const detail = await api().get(`/api/v1/admin/sellers/${s.sellerId}`).set(bearer(s.admin)).expect(200);
    await api().post(`/api/v1/admin/sellers/${s.sellerId}/approve`).set(bearer(s.admin)).expect(400); // document not approved yet
    await api().patch(`/api/v1/admin/sellers/documents/${detail.body.documents[0].id}`).set(bearer(s.admin)).send({ status: 'APPROVED' }).expect(200);
    await api().post(`/api/v1/admin/sellers/${s.sellerId}/approve`).set(bearer(s.admin)).expect(200);

    const accounts = await prisma.ledgerAccount.count({ where: { sellerId: s.sellerId } });
    expect(accounts).toBe(3);
  });

  it('4. the seller lists a product with variants and an image; admin approves; search finds it', async () => {
    const cats = await api().get('/api/v1/categories').expect(200);
    const categoryId = cats.body.find((c: { slug: string }) => c.slug === 'home-kitchen').id;
    const title = `Flowtest Ceramic Mug Set ${run}`;
    const created = await api().post('/api/v1/seller/products').set(bearer(s.seller)).send({
      title, titleAr: 'طقم أكواب سيراميك', categoryId, description: 'Six handmade mugs.',
      variants: [
        { sku: `MUG-${run}-M`, optionValues: { Size: 'M' }, priceMinor: '10000', initialStock: 5 },
        { sku: `MUG-${run}-L`, optionValues: { Size: 'L' }, priceMinor: '12000', compareAtMinor: '15000', initialStock: 3 },
      ],
    }).expect(201);
    s.productId = created.body.id;
    s.productSlug = created.body.slug;
    s.variantM = created.body.variants.find((v: { sku: string }) => v.sku.endsWith('-M')).id;

    // cannot submit without an image
    await api().patch(`/api/v1/seller/products/${s.productId}`).set(bearer(s.seller)).send({ submitForReview: true }).expect(400);
    await api().post(`/api/v1/seller/products/${s.productId}/images`).set(bearer(s.seller)).attach('file', PNG, 'mug.png').expect(201);
    const submitted = await api().patch(`/api/v1/seller/products/${s.productId}`).set(bearer(s.seller)).send({ submitForReview: true }).expect(200);
    expect(submitted.body.status).toBe('PENDING_REVIEW');

    // not visible before approval
    await api().get(`/api/v1/products/${s.productSlug}`).expect(404);
    await api().post(`/api/v1/admin/products/${s.productId}/approve`).set(bearer(s.admin)).expect(200);
    const page = await api().get(`/api/v1/products/${s.productSlug}`).expect(200);
    expect(page.body.variants).toHaveLength(2);
    expect(page.body.store.isHouse).toBe(false); // a marketplace seller: the shop names and links the store
    expect(page.body.variants.find((v: { priceMinor: string }) => v.priceMinor === '12000').discountPercent).toBe(20);

    const found = await api().get('/api/v1/search').query({ q: `flowtest mug ${run}` }).expect(200);
    expect(found.body.items.map((i: { id: string }) => i.id)).toContain(s.productId);
  });

  // ------------------------------------------------------------ cart & checkout

  it('5. cart with two sellers: server prices, flash deal, per-seller delivery, coupon split to the dirham', async () => {
    const powerBank = await api().get('/api/v1/products/nova-powercore-20000-power-bank').expect(200);
    s.variantPowerBank = powerBank.body.variants[0].id;

    await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: s.variantM, quantity: 2, priceMinor: '1' }).expect(400); // no client prices
    await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: s.variantM, quantity: 6 }).expect(409); // only 5 in stock
    await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: s.variantM, quantity: 2 }).expect(201);
    const cart = await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: s.variantPowerBank, quantity: 1 }).expect(201);

    expect(cart.body.groups).toHaveLength(2);
    const pb = cart.body.groups.flatMap((g: { items: unknown[] }) => g.items).find((i: { variantId: string }) => i.variantId === s.variantPowerBank);
    expect(pb).toMatchObject({ unitPriceMinor: '7900', listPriceMinor: '9900', onDeal: true }); // Weekend Flash Deals
    // mugs 2 x 100 = 200 (free delivery >= 100); power bank 79 (< 100 -> QAR 10 delivery)
    expect(cart.body.totals).toMatchObject({ subtotalMinor: '27900', deliveryFeeMinor: '1000', totalMinor: '28900' });

    const withCoupon = await api().post('/api/v1/cart/coupon').set(bearer(s.customer)).send({ code: 'WELCOME10' }).expect(201);
    // 10% of 279.00 = 27.90, spread 20.00 / 7.90; power-bank seller still pays delivery (71.10 < 100)
    expect(withCoupon.body.coupon).toMatchObject({ code: 'WELCOME10', applied: true, discountMinor: '2790' });
    expect(withCoupon.body.totals).toMatchObject({ discountMinor: '2790', deliveryFeeMinor: '1000', totalMinor: '26110' });
    expect(withCoupon.body.canCheckout).toBe(true);
    s.expectedTotal = '26110';
  });

  it('6. checkout is idempotent, reserves stock, splits the order per seller and writes a balanced ledger', async () => {
    const addr = await api().post('/api/v1/addresses').set(bearer(s.customer)).send({ recipientName: 'Flow Tester', phone: '+97455512345', city: 'Doha' });
    expect(addr.status).toBe(400); // Qatar needs zone / street / building
    const address = await api().post('/api/v1/addresses').set(bearer(s.customer))
      .send({ label: 'Home', recipientName: 'Flow Tester', phone: '+97455512345', city: 'Doha', zone: '66', street: '901', building: '12' }).expect(201);

    const key = `flow-${run}`;
    const first = await api().post('/api/v1/checkout').set(bearer(s.customer)).set('Idempotency-Key', key).send({ addressId: address.body.id, paymentMethod: 'CARD' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ totalMinor: s.expectedTotal, status: 'CONFIRMED' });
    s.orderNumber = first.body.orderNumber;

    const again = await api().post('/api/v1/checkout').set(bearer(s.customer)).set('Idempotency-Key', key).send({ addressId: address.body.id, paymentMethod: 'CARD' });
    expect(again.body).toMatchObject({ orderNumber: s.orderNumber, reused: true }); // double tap = same order
    expect(await prisma.order.count({ where: { user: { email: `flow.customer.${run}@jovia.test` } } })).toBe(1);

    const order = await api().get(`/api/v1/orders/${s.orderNumber}`).set(bearer(s.customer)).expect(200);
    expect(order.body.sellerOrders).toHaveLength(2);
    // business-confidential numbers are not exposed to customers
    expect(JSON.stringify(order.body)).not.toMatch(/commissionMinor|sellerNetMinor|commissionSnapshot/);
    const mine = order.body.sellerOrders.find((so: { sellerId: string }) => so.sellerId === s.sellerId);
    const other = order.body.sellerOrders.find((so: { sellerId: string }) => so.sellerId !== s.sellerId);
    s.myShipment = mine.id;
    s.gadgetsShipment = other.id;
    s.powerBankItem = other.items[0].id;

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variantM } });
    expect(inv).toMatchObject({ onHand: 5, reserved: 2 });

    // Ledger: 10% commission, FastMoveX-funded coupon reimbursed to sellers, books balance
    expect(await ledgerTotal()).toBe(0n);
    const bal = await api().get('/api/v1/seller/finance/balance').set(bearer(s.seller)).expect(200);
    // goods 200.00 - commission 20.00 = 180.00 (the 20.00 coupon share is paid by FastMoveX, not the seller)
    expect(bal.body).toMatchObject({ pendingMinor: '18000', availableMinor: '0' });
    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { orderNumber: s.orderNumber } } });
    expect(payment).toMatchObject({ status: 'CAPTURED', amountMinor: 26110n, provider: 'test' });
  });

  // -------------------------------------------------------------- fulfilment

  it('7. seller-delivered shipment goes through every status and commits stock', async () => {
    for (const status of ['PREPARING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await api().post(`/api/v1/seller/orders/${s.myShipment}/status`).set(bearer(s.seller)).send({ status }).expect(200);
    }
    await api().post(`/api/v1/seller/orders/${s.myShipment}/status`).set(bearer(s.seller)).send({ status: 'PREPARING' }).expect(400); // no going back
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variantM } });
    expect(inv).toMatchObject({ onHand: 3, reserved: 0 });
  });

  it('8. sellers cannot see each other’s orders; customers cannot use admin routes', async () => {
    const gadgets = (await login('seller.gadgets@demo.jovia.test')).accessToken;
    s.gadgets = gadgets;
    await api().get(`/api/v1/seller/orders/${s.myShipment}`).set(bearer(gadgets)).expect(404);
    await api().post(`/api/v1/seller/orders/${s.myShipment}/status`).set(bearer(gadgets)).send({ status: 'DELIVERED' }).expect(404);
    await api().get('/api/v1/admin/orders').set(bearer(s.customer)).expect(403);
    const stranger = await register(`flow.stranger.${run}@jovia.test`);
    await api().get(`/api/v1/orders/${s.orderNumber}`).set(bearer(stranger.accessToken)).expect(404);
  });

  it('9. FastMoveX fleet: ready for pickup -> ops assigns courier -> pickup -> delivery with the customer’s code', async () => {
    await api().post(`/api/v1/seller/orders/${s.gadgetsShipment}/status`).set(bearer(s.gadgets)).send({ status: 'PREPARING' }).expect(200);
    await api().post(`/api/v1/seller/orders/${s.gadgetsShipment}/status`).set(bearer(s.gadgets)).send({ status: 'READY_FOR_PICKUP' }).expect(200);

    const ops = (await login('ops@demo.jovia.test')).accessToken;
    const job = await until(async () => {
      const list = await api().get('/api/v1/admin/deliveries').query({ unassigned: 'true' }).set(bearer(ops));
      return list.body.find((d: { sellerOrderId: string }) => d.sellerOrderId === s.gadgetsShipment);
    }, 'delivery job to be created');
    const couriers = await api().get('/api/v1/admin/deliveries/couriers').set(bearer(ops)).expect(200);
    const courierId = couriers.body.find((c: { fullName: string }) => c.fullName === 'Khalid Courier').id;
    await api().post(`/api/v1/admin/deliveries/${job.id}/assign`).set(bearer(ops)).send({ courierUserId: courierId }).expect(200);

    const courier = (await login('courier@demo.jovia.test')).accessToken;
    await api().get('/api/v1/courier/jobs').set(bearer(s.customer)).expect(403);
    await api().post(`/api/v1/courier/jobs/${job.id}/pickup`).set(bearer(courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${job.id}/out-for-delivery`).set(bearer(courier)).expect(200);

    const tracking = await api().get(`/api/v1/orders/${s.orderNumber}/tracking`).set(bearer(s.customer)).expect(200);
    const shipment = tracking.body.shipments.find((x: { delivery: { method: string } | null }) => x.delivery?.method === 'JOVIA');
    expect(shipment.delivery.courier).toBe('Khalid');
    const code: string = shipment.delivery.deliveryCode;
    const wrong = code === '0000' ? '1111' : '0000';
    await api().post(`/api/v1/courier/jobs/${job.id}/deliver`).set(bearer(courier)).field('code', wrong).expect(400);
    await api().post(`/api/v1/courier/jobs/${job.id}/deliver`).set(bearer(courier)).field('code', code).field('recipientName', 'Flow Tester').attach('photo', PNG, 'door.png').expect(200);

    const order = await api().get(`/api/v1/orders/${s.orderNumber}`).set(bearer(s.customer)).expect(200);
    expect(order.body.status).toBe('DELIVERED');
  });

  // ----------------------------------------------------------- returns & refunds

  it('10. return -> seller approves -> goods received -> finance refunds; ledger still balances', async () => {
    const before = await api().get('/api/v1/seller/finance/balance').set(bearer(s.gadgets)).expect(200);
    const ret = await api().post(`/api/v1/orders/${s.orderNumber}/returns`).set(bearer(s.customer)).send({ orderItemId: s.powerBankItem, quantity: 1, reason: 'Stopped charging after a day' }).expect(201);
    await api().post(`/api/v1/orders/${s.orderNumber}/returns`).set(bearer(s.customer)).send({ orderItemId: s.powerBankItem, quantity: 1, reason: 'Trying to return twice' }).expect(400);

    await api().post(`/api/v1/seller/returns/${ret.body.id}/decision`).set(bearer(s.seller)).send({ decision: 'APPROVED' }).expect(404); // not their item
    await api().post(`/api/v1/seller/returns/${ret.body.id}/decision`).set(bearer(s.gadgets)).send({ decision: 'APPROVED' }).expect(200);
    await api().post(`/api/v1/seller/returns/${ret.body.id}/received`).set(bearer(s.gadgets)).expect(200);

    const finance = (await login('finance@demo.jovia.test')).accessToken;
    s.finance = finance;
    const refunds = await api().get('/api/v1/admin/refunds').query({ status: 'PENDING' }).set(bearer(finance)).expect(200);
    const refund = refunds.body.items.find((r: { order: { orderNumber: string } }) => r.order.orderNumber === s.orderNumber);
    expect(refund.amountMinor).toBe('7110'); // 79.00 - 7.90 coupon share: exactly what was paid for that line
    await api().post(`/api/v1/admin/refunds/${refund.id}/approve`).set(bearer(finance)).expect(200);
    await api().post(`/api/v1/admin/refunds/${refund.id}/approve`).set(bearer(finance)).expect(409); // no double refund

    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { orderNumber: s.orderNumber } } });
    expect(payment).toMatchObject({ refundedMinor: 7110n, status: 'PARTIALLY_REFUNDED' });
    expect(await ledgerTotal()).toBe(0n);
    const after = await api().get('/api/v1/seller/finance/balance').set(bearer(s.gadgets)).expect(200);
    expect(BigInt(after.body.pendingMinor)).toBeLessThan(BigInt(before.body.pendingMinor));
  });

  // -------------------------------------------------------------- money out

  it('11. after the return window earnings become available; payout needs two finance people', async () => {
    // simulate 20 days passing for this seller's shipment
    await prisma.sellerOrder.update({ where: { id: s.myShipment }, data: { deliveredAt: new Date(Date.now() - 20 * 86_400_000) } });
    const release = await api().post('/api/v1/admin/finance/release-due').set(bearer(s.finance)).expect(200);
    expect(release.body.released).toBeGreaterThanOrEqual(1);
    const bal = await api().get('/api/v1/seller/finance/balance').set(bearer(s.seller)).expect(200);
    expect(bal.body).toMatchObject({ pendingMinor: '0', availableMinor: '18000', requestableMinor: '18000' });

    await api().post('/api/v1/seller/payouts').set(bearer(s.seller)).send({ amountMinor: '18001' }).expect(400);
    const payout = await api().post('/api/v1/seller/payouts').set(bearer(s.seller)).send({ amountMinor: '15000' }).expect(201);
    await api().post('/api/v1/seller/payouts').set(bearer(s.seller)).send({ amountMinor: '5000' }).expect(400); // only 30.00 left to request

    await api().post(`/api/v1/admin/payouts/${payout.body.id}/approve`).set(bearer(s.finance)).expect(200);
    await api().post(`/api/v1/admin/payouts/${payout.body.id}/mark-paid`).set(bearer(s.finance)).send({ reference: `TRF-${run}` }).expect(403); // four-eyes
    await api().post(`/api/v1/admin/payouts/${payout.body.id}/mark-paid`).set(bearer(s.admin)).send({ reference: `TRF-${run}` }).expect(403); // ADMIN lacks payouts.mark_paid
    const finance2 = (await login('finance2@demo.jovia.test')).accessToken;
    await api().post(`/api/v1/admin/payouts/${payout.body.id}/mark-paid`).set(bearer(finance2)).send({ reference: `TRF-${run}` }).expect(200);

    const final = await api().get('/api/v1/seller/finance/balance').set(bearer(s.seller)).expect(200);
    expect(final.body).toMatchObject({ availableMinor: '3000', paidOutMinor: '15000', inPayoutMinor: '0' });
    expect(await ledgerTotal()).toBe(0n);
  });

  // ------------------------------------------------------------ platform checks

  it('12. the ledger cannot be edited, analytics sees the order, and the customer was notified', async () => {
    await expect(prisma.$executeRawUnsafe('UPDATE "LedgerEntry" SET "amountMinor" = 0')).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM "LedgerTransaction"')).rejects.toThrow(/immutable/);

    const overview = await api().get('/api/v1/admin/analytics/overview').query({ range: 'today' }).set(bearer(s.admin)).expect(200);
    expect(overview.body.orders).toBeGreaterThanOrEqual(1);
    expect(BigInt(overview.body.gmvMinor)).toBeGreaterThanOrEqual(26110n);

    const pays = await api().get('/api/v1/admin/payments').set(bearer(s.finance)).expect(200);
    expect(pays.body.items.find((p: { order: { orderNumber: string } }) => p.order.orderNumber === s.orderNumber)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedMinor: '7110' });
    await api().get('/api/v1/admin/payments').set(bearer(s.customer)).expect(403);

    const csv = await api().get('/api/v1/admin/analytics/export').query({ report: 'orders', format: 'csv', range: 'today' }).set(bearer(s.admin)).expect(200);
    expect(csv.text).toContain(s.orderNumber);

    const unread = await until(async () => {
      const r = await api().get('/api/v1/me/notifications/unread-count').set(bearer(s.customer));
      return r.body.unread >= 3 ? r.body.unread : null;
    }, 'order notifications');
    expect(unread).toBeGreaterThanOrEqual(3);
  });

  it('13. reviews: only after delivery, once per item, rating updates from approved reviews', async () => {
    const order = await api().get(`/api/v1/orders/${s.orderNumber}`).set(bearer(s.customer)).expect(200);
    const mugItem = order.body.sellerOrders.find((so: { id: string }) => so.id === s.myShipment).items[0].id;
    await api().post('/api/v1/reviews').set(bearer(s.customer)).send({ orderItemId: mugItem, target: 'PRODUCT', rating: 5 }).expect(201);
    await api().post('/api/v1/reviews').set(bearer(s.customer)).send({ orderItemId: mugItem, target: 'PRODUCT', rating: 1 }).expect(409);
    const page = await api().get(`/api/v1/products/${s.productSlug}/reviews`).expect(200);
    expect(page.body.summary).toEqual({ ratingAvg: 5, ratingCount: 1, photoReviews: 0 });
    expect(page.body.items[0].author).toBe('Flow T.');
  });
});
