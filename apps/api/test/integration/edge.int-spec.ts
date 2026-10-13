/**
 * EDGE CASES on a real database: stock, price changes, failed / pending / late payments, cash on delivery with a
 * partial cancellation, coupon abuse, customer cancellation, and the read-heavy endpoints (home, search, analytics).
 * Uses the demo sellers "Pearl Home Living" and "Doha Gadgets Hub" (npm run db:seed:demo). Prices it changes are restored.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { UnpaidOrdersService } from '../../src/orders/unpaid-orders.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');

describe('FastMoveX edge cases — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const t: Record<string, string> = {};
  const v: Record<string, string> = {};
  const originalPrices = new Map<string, bigint>();

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }
  async function variantBySku(sku: string) {
    const row = await prisma.productVariant.findFirstOrThrow({ where: { sku, product: { store: { slug: { in: ['pearl-home-living', 'doha-gadgets-hub'] } } } }, select: { id: true, priceMinor: true } });
    if (!originalPrices.has(row.id)) originalPrices.set(row.id, row.priceMinor);
    return row.id;
  }
  async function setPrice(variantId: string, price: string) {
    await api().patch(`/api/v1/seller/variants/${variantId}`).set(bearer(t.home)).send({ priceMinor: price, compareAtMinor: null }).expect(200);
  }
  async function reserved(variantId: string) {
    return (await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reserved;
  }
  async function clearCart() {
    await api().delete('/api/v1/cart').set(bearer(t.customer)).expect(200);
  }
  async function checkout(method: 'CARD' | 'COD', key = randomBytes(6).toString('hex')) {
    return api().post('/api/v1/checkout').set(bearer(t.customer)).set('Idempotency-Key', key).send({ addressId: t.address, paymentMethod: method });
  }
  function webhook(ref: string, status: string, id = `evt_${randomBytes(6).toString('hex')}`) {
    const body = JSON.stringify({ id, type: `payment.${status.toLowerCase()}`, ref, status });
    const sig = createHmac('sha256', process.env.JWT_ACCESS_SECRET!).update(body).digest('hex');
    return api().post('/api/v1/payments/webhook/test').set('Content-Type', 'application/json').set('X-Test-Signature', sig).send(body);
  }
  const ledgerTotal = async () => (await prisma.ledgerEntry.aggregate({ _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);

    const email = `edge.${run}@fastmovex.test`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Edge Case', email, password: 'Edge-Pass-123' }).expect(201);
    t.customer = reg.body.accessToken;
    const addr = await api().post('/api/v1/addresses').set(bearer(t.customer)).send({ recipientName: 'Edge Case', phone: '+97455500011', city: 'Doha', zone: '52', street: '220', building: '7' }).expect(201);
    t.address = addr.body.id;
    t.home = await login('seller.home@demo.fastmovex.test');
    t.gadgets = await login('seller.gadgets@demo.fastmovex.test');
    t.finance = await login('finance@demo.fastmovex.test');
    t.admin = await login('admin@demo.fastmovex.test');
    v.blocks = await variantBySku('PKB-28');
    v.yogaBlack = await variantBySku('PYM-BLK');
    v.yogaPurple = await variantBySku('PYM-PRP');
    v.caseClear = await variantBySku('NCASE61-CLR');
    v.soldOut = await variantBySku('FPC-WHT');
  });

  afterAll(async () => {
    for (const [id, price] of originalPrices) await prisma.productVariant.update({ where: { id }, data: { priceMinor: price } });
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('out-of-stock variants cannot be added', async () => {
    const res = await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.soldOut, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Out of stock');
  });

  it('price changed after it was added: checkout is blocked until the customer confirms', async () => {
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.blocks, quantity: 1 }).expect(201);
    await setPrice(v.blocks, '8500');
    const cart = await api().get('/api/v1/cart').set(bearer(t.customer)).expect(200);
    expect(cart.body.canCheckout).toBe(false);
    expect(cart.body.groups[0].items[0]).toMatchObject({ unitPriceMinor: '8500', priceChangedFromMinor: '7900', issues: ['PRICE_CHANGED'] });
    expect((await checkout('COD')).status).toBe(409);
    const acked = await api().post('/api/v1/cart/acknowledge-prices').set(bearer(t.customer)).expect(201);
    expect(acked.body.canCheckout).toBe(true);
    await clearCart();
    await setPrice(v.blocks, originalPrices.get(v.blocks)!.toString());
  });

  it('failed card payment: order cancelled, stock + coupon given back, items back in the cart', async () => {
    await setPrice(v.yogaBlack, '10013'); // test gateway declines amounts ending in .13
    const reservedBefore = await reserved(v.yogaBlack);
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.yogaBlack, quantity: 1 }).expect(201);
    await api().post('/api/v1/cart/coupon').set(bearer(t.customer)).send({ code: 'FREESHIP' }).expect(201);
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { code: 'FREESHIP' } });

    const res = await checkout('CARD');
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ status: 'FAILED', failureReason: 'Card declined (test)' });
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { sellerOrders: true, payments: true } });
    expect(order.status).toBe('CANCELLED');
    expect(order.sellerOrders.every((so) => so.status === 'CANCELLED')).toBe(true);
    expect(await reserved(v.yogaBlack)).toBe(reservedBefore);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(coupon.usedCount);
    expect(await prisma.couponRedemption.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { refId: order.id } })).toBe(0); // no money, no ledger

    const cart = await api().get('/api/v1/cart').set(bearer(t.customer)).expect(200);
    expect(cart.body.groups[0].items[0].variantId).toBe(v.yogaBlack);
    expect(cart.body.coupon.code).toBe('FREESHIP');
    await clearCart();
    await setPrice(v.yogaBlack, originalPrices.get(v.yogaBlack)!.toString());
  });

  it('pending (3-D Secure) payment is confirmed by a signed webhook; replays are ignored', async () => {
    await setPrice(v.yogaPurple, '10001'); // amounts ending in .01 wait for the webhook
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.yogaPurple, quantity: 1 }).expect(201);
    const res = await checkout('CARD');
    expect(res.body).toMatchObject({ status: 'PENDING', payment: { status: 'PENDING' } });
    expect(res.body.payment.redirectUrl).toContain('ref=');
    const payment = await prisma.payment.findFirstOrThrow({ where: { order: { orderNumber: res.body.orderNumber } } });

    await webhook(payment.providerRef!, 'CAPTURED').set('X-Test-Signature', 'forged').expect(403);
    const eventId = `evt_${run}_ok`;
    await webhook(payment.providerRef!, 'CAPTURED', eventId).expect(200);
    const replay = await webhook(payment.providerRef!, 'CAPTURED', eventId).expect(200);
    expect(replay.body).toEqual({ duplicate: true });

    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber } });
    expect(order.status).toBe('CONFIRMED');
    expect(await prisma.ledgerTransaction.count({ where: { refId: order.id, type: 'ORDER_CAPTURED' } })).toBe(1);
    expect(await ledgerTotal()).toBe(0n);
  });

  it('abandoned payment expires after 30 min; money that still arrives later is refunded through the ledger', async () => {
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.yogaPurple, quantity: 1 }).expect(201);
    const res = await checkout('CARD');
    expect(res.body.status).toBe('PENDING');
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { payments: true } });
    const reservedBefore = await reserved(v.yogaPurple);

    await prisma.order.update({ where: { id: order.id }, data: { placedAt: new Date(Date.now() - 40 * 60_000) } });
    expect(await app.get(UnpaidOrdersService).expireStale()).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect(await reserved(v.yogaPurple)).toBe(reservedBefore - 1);

    // the customer's bank confirms anyway
    await webhook(order.payments[0].providerRef!, 'CAPTURED').expect(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED'); // not resurrected
    const refund = await prisma.refund.findUniqueOrThrow({ where: { idempotencyKey: `late_payment_${order.payments[0].id}` } });
    expect(refund).toMatchObject({ status: 'PENDING', amountMinor: 10001n, sellerOrderId: null });
    await api().post(`/api/v1/admin/refunds/${refund.id}/approve`).set(bearer(t.finance)).expect(200);

    const payable = await prisma.ledgerEntry.aggregate({ where: { account: { type: 'REFUND_PAYABLE' } }, _sum: { amountMinor: true } });
    expect(payable._sum.amountMinor ?? 0n).toBe(0n);
    expect(await ledgerTotal()).toBe(0n);
    await clearCart();
    await setPrice(v.yogaPurple, originalPrices.get(v.yogaPurple)!.toString());
  });

  it('cash on delivery with one seller cancelling: only the delivered part is collected, books balance', async () => {
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.blocks, quantity: 1 }).expect(201);
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.caseClear, quantity: 1 }).expect(201);
    const res = await checkout('COD');
    expect(res.body.status).toBe('CONFIRMED');
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { sellerOrders: { include: { seller: { select: { store: { select: { slug: true } } } } } } } });
    expect(await prisma.ledgerTransaction.count({ where: { refId: order.id } })).toBe(0); // COD: nothing collected yet

    const homeShipment = order.sellerOrders.find((so) => so.seller.store?.slug === 'pearl-home-living')!;
    const gadgetsShipment = order.sellerOrders.find((so) => so.seller.store?.slug === 'doha-gadgets-hub')!;
    const blocksReserved = await reserved(v.blocks);
    await api().post(`/api/v1/seller/orders/${homeShipment.id}/cancel`).set(bearer(t.home)).send({ reason: 'Damaged in the warehouse' }).expect(200);
    expect(await reserved(v.blocks)).toBe(blocksReserved - 1);

    for (const status of ['PREPARING', 'SHIPPED', 'DELIVERED']) {
      await api().post(`/api/v1/seller/orders/${gadgetsShipment.id}/status`).set(bearer(t.gadgets)).send({ status }).expect(200);
    }
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    // phone case 49.00 + 10.00 delivery (the cancelled blocks are not collected)
    expect(payment).toMatchObject({ status: 'CAPTURED', amountMinor: 5900n });
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(0); // nothing was paid for the cancelled part
    expect(await ledgerTotal()).toBe(0n);
    t.codOrder = res.body.orderNumber;
  });

  it('coupon abuse: first-order coupon after an order, unknown codes, guests', async () => {
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.blocks, quantity: 1 }).expect(201);
    const reused = await api().post('/api/v1/cart/coupon').set(bearer(t.customer)).send({ code: 'WELCOME10' });
    expect(reused.status).toBe(400);
    expect(reused.body.message).toBe('This code is only for your first order');
    const unknown = await api().post('/api/v1/cart/coupon').set(bearer(t.customer)).send({ code: 'FREE100' });
    expect(unknown.body.message).toBe('This code is not valid');
    await api().post('/api/v1/cart/coupon').send({ code: 'WELCOME10' }).expect(401);
    await clearCart();
  });

  it('customer can cancel before shipping, not after', async () => {
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.blocks, quantity: 2 }).expect(201);
    const before = await reserved(v.blocks);
    const res = await checkout('COD');
    expect(await reserved(v.blocks)).toBe(before + 2);
    await api().post(`/api/v1/orders/${res.body.orderNumber}/cancel`).set(bearer(t.customer)).send({ reason: 'Ordered by mistake' }).expect(200);
    expect(await reserved(v.blocks)).toBe(before);
    await api().post(`/api/v1/orders/${t.codOrder}/cancel`).set(bearer(t.customer)).send({ reason: 'Too late' }).expect(400);
  });

  it('read endpoints on real data: home, search facets, analytics, exports', async () => {
    const home = await api().get('/api/v1/home').expect(200);
    const keys = home.body.sections.map((s: { key: string }) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['hero', 'categories', 'flash_deals', 'featured', 'featured_sellers', 'best_sellers', 'new_arrivals']));
    const flash = home.body.sections.find((s: { key: string }) => s.key === 'flash_deals');
    expect(flash.items.every((i: { dealPriceMinor: string; priceMinor: string }) => BigInt(i.dealPriceMinor) < BigInt(i.priceMinor))).toBe(true);

    const search = await api().get('/api/v1/search').query({ category: 'perfumes', sort: 'price_asc', inStock: 'true' }).expect(200);
    const prices = search.body.items.map((i: { priceMinor: string }) => Number(i.priceMinor));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(search.body.facets.price.minMinor).toBeTruthy();
    const filtered = await api().get('/api/v1/search').query({ minPrice: '10000', maxPrice: '20000' }).expect(200);
    expect(filtered.body.items.every((i: { priceMinor: string }) => Number(i.priceMinor) >= 10000 && Number(i.priceMinor) <= 20000)).toBe(true);
    const suggest = await api().get('/api/v1/search/suggest').query({ q: 'oud' }).expect(200);
    expect(suggest.body.products.length).toBeGreaterThan(0);

    const ts = await api().get('/api/v1/admin/analytics/timeseries').query({ range: '7d' }).set(bearer(t.admin)).expect(200);
    expect(ts.body.bucket).toBe('day');
    expect(ts.body.points).toHaveLength(7);
    const top = await api().get('/api/v1/admin/analytics/top').query({ kind: 'categories', range: '30d' }).set(bearer(t.admin)).expect(200);
    expect(top.body.items.length).toBeGreaterThan(0);
    const xlsx = await api().get('/api/v1/admin/analytics/export').query({ report: 'products', format: 'xlsx', range: '30d' }).set(bearer(t.admin)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const seller = await api().get('/api/v1/seller/analytics/overview').query({ range: '30d' }).set(bearer(t.gadgets)).expect(200);
    expect(seller.body.orders).toBeGreaterThan(0);

    const support = await login('support@demo.fastmovex.test');
    await api().get('/api/v1/admin/analytics/overview').set(bearer(support)).expect(403);
    await api().get('/api/v1/admin/finance/summary').set(bearer(support)).expect(403);
    const summary = await api().get('/api/v1/admin/finance/summary').set(bearer(t.finance)).expect(200);
    expect(summary.body.ledger.length).toBeGreaterThan(0);
  });

  it('admin moves a category with its subcategories; paths are re-rooted in one statement', async () => {
    const cats = await api().get('/api/v1/categories').expect(200);
    const id = (slug: string) => cats.body.find((c: { slug: string }) => c.slug === slug).id;
    const parent = await api().post('/api/v1/admin/categories').set(bearer(t.admin)).send({ name: `Edge Parent ${run}`, nameAr: 'اختبار', parentId: id('electronics') }).expect(201);
    const child = await api().post('/api/v1/admin/categories').set(bearer(t.admin)).send({ name: `Edge Child ${run}`, nameAr: 'اختبار', parentId: parent.body.id }).expect(201);
    await api().patch(`/api/v1/admin/categories/${parent.body.id}`).set(bearer(t.admin)).send({ parentId: child.body.id }).expect(400); // into its own subtree
    const moved = await api().patch(`/api/v1/admin/categories/${parent.body.id}`).set(bearer(t.admin)).send({ parentId: id('home-kitchen') }).expect(200);
    expect(moved.body.path).toBe(`home-kitchen/${parent.body.slug}`);
    const reChild = await prisma.category.findUniqueOrThrow({ where: { id: child.body.id } });
    expect(reChild).toMatchObject({ path: `home-kitchen/${parent.body.slug}/${child.body.slug}`, depth: 2 });
    await api().delete(`/api/v1/admin/categories/${parent.body.id}`).set(bearer(t.admin)).expect(409); // still has a child
    await api().delete(`/api/v1/admin/categories/${child.body.id}`).set(bearer(t.admin)).expect(204);
    await api().delete(`/api/v1/admin/categories/${parent.body.id}`).set(bearer(t.admin)).expect(204);
  });

  it('admin changes the market delivery pricing; carts use it immediately; a support admin cannot', async () => {
    const support = await login('support@demo.fastmovex.test');
    await api().patch('/api/v1/admin/countries/QA').set(bearer(support)).send({ deliveryConfig: { flatFeeMinor: '0' } }).expect(403);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(t.admin)).send({ paymentMethods: [] }).expect(400);
    await api().patch('/api/v1/admin/countries/QA').set(bearer(t.admin)).send({ deliveryConfig: { flatFeeMinor: '1500' } }).expect(200);
    try {
      await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId: v.caseClear, quantity: 1 }).expect(201);
      const cart = await api().get('/api/v1/cart').set(bearer(t.customer)).expect(200);
      expect(cart.body.totals).toMatchObject({ subtotalMinor: '4900', deliveryFeeMinor: '1500', totalMinor: '6400' });
    } finally {
      await api().patch('/api/v1/admin/countries/QA').set(bearer(t.admin)).send({ deliveryConfig: { flatFeeMinor: '1000' } }).expect(200);
      await clearCart();
    }
    const country = await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } });
    expect(country.deliveryConfig).toMatchObject({ flatFeeMinor: '1000', freeOverMinor: '10000' }); // other keys kept
  });
});
