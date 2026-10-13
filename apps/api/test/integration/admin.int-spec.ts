/**
 * ADMIN (single merchant) on a real database: FastMoveX staff add a product to FastMoveX's own store, publish it, sell it and
 * fulfil the order; stock and CSV import/export; permissions per staff role.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { parse } from 'csv-parse/sync';
import { toCsv } from '../../src/analytics/export.service';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex').toUpperCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Admin dashboard API — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const t: Record<string, string> = {};
  let productId = '';
  let slug = '';
  let variantId = '';

  async function login(identifier: string, password = DEMO_PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ identifier, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    t.admin = await login('admin@demo.fastmovex.test');
    t.support = await login('support@demo.fastmovex.test');
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Admin Flow Buyer', email: `adminflow.${run.toLowerCase()}@fastmovex.test`, password: 'Buyer-Pass-123' }).expect(201);
    t.customer = reg.body.accessToken;
    t.address = (await api().post('/api/v1/addresses').set(bearer(t.customer)).send({ recipientName: 'Buyer', phone: '+97455500022', city: 'Doha', zone: '60', street: '800', building: '3' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('FastMoveX has its own store, created by the base seed, that cannot be signed into', async () => {
    const house = await prisma.seller.findFirstOrThrow({ where: { isHouse: true }, include: { store: true, owner: true } });
    expect(house.status).toBe('APPROVED');
    expect(house.store?.isActive).toBe(true);
    expect(house.owner.passwordHash).toBeNull();
    const rule = await prisma.commissionRule.findFirst({ where: { scope: 'SELLER', sellerId: house.id } });
    expect(rule?.rateBps).toBe(0); // the platform does not charge itself commission
  });

  it('staff create a product in the FastMoveX store; it cannot go live without a photo', async () => {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const res = await api().post('/api/v1/admin/products').set(bearer(t.admin)).send({
      title: `Admin Kettle ${run}`, titleAr: 'غلاية', categoryId: cat.id, shortDescription: '1.7 L', tags: ['Kitchen', 'kitchen', 'Gift'],
      seoTitle: 'Kettle', variants: [{ sku: `AK-${run}`, barcode: `629${run}01`, priceMinor: '8900', costPriceMinor: '5000', initialStock: 3 }],
    }).expect(201);
    productId = res.body.id; slug = res.body.slug; variantId = res.body.variants[0].id;
    expect(res.body).toMatchObject({ status: 'DRAFT', tags: ['kitchen', 'gift'], store: { isHouse: true } });
    expect(res.body.variants[0].costPriceMinor).toBe('5000');
    const noPhoto = await api().post(`/api/v1/admin/products/${productId}/status`).set(bearer(t.admin)).send({ status: 'ACTIVE' });
    expect(noPhoto.status).toBe(400);
    await api().post(`/api/v1/admin/products/${productId}/images`).set(bearer(t.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${productId}/status`).set(bearer(t.admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('the published product is on the shop; cost price and staff-only data never are', async () => {
    const pub = await api().get(`/api/v1/products/${slug}`).expect(200);
    expect(pub.body.store.slug).toBe('fastmovex');
    expect(pub.body.store.isHouse).toBe(true); // the shop says "Sold and delivered by FastMoveX"
    expect(pub.body.shortDescription).toBe('1.7 L');
    expect(JSON.stringify(pub.body)).not.toContain('costPriceMinor');
    const found = await api().get('/api/v1/admin/products').query({ q: `629${run}01` }).set(bearer(t.admin)).expect(200); // search by barcode
    expect(found.body.items.map((p: { id: string }) => p.id)).toContain(productId);
  });

  it('a customer buys it; staff fulfil the shipment step by step; stock is committed when it ships', async () => {
    await api().post('/api/v1/cart/items').set(bearer(t.customer)).send({ variantId, quantity: 2 }).expect(201);
    const order = await api().post('/api/v1/checkout').set(bearer(t.customer)).set('Idempotency-Key', `k-${run}`).send({ addressId: t.address, paymentMethod: 'COD' }).expect(201);
    const detail = await api().get(`/api/v1/admin/orders/${order.body.orderNumber}`).set(bearer(t.admin)).expect(200);
    const shipment = detail.body.sellerOrders[0];
    expect(shipment.seller.isHouse).toBe(true);
    // Commission on the platform's own goods is zero
    const so = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(so.commissionMinor).toBe(0n);

    const found = await api().get('/api/v1/admin/orders').query({ q: 'Admin Flow Buyer' }).set(bearer(t.admin)).expect(200);
    expect(found.body.items.map((o: { orderNumber: string }) => o.orderNumber)).toContain(order.body.orderNumber);
    const numbers = async () => (await api().get('/api/v1/admin/orders').query({ view: 'to_fulfil' }).set(bearer(t.admin)).expect(200)).body.items.map((o: { orderNumber: string }) => o.orderNumber);
    expect(await numbers()).toContain(order.body.orderNumber); // "To ship" tab

    const back = await api().post(`/api/v1/admin/orders/shipments/${shipment.id}/status`).set(bearer(t.admin)).send({ status: 'DELIVERED' });
    expect(back.status).toBe(400); // cannot skip steps
    for (const status of ['PREPARING', 'SHIPPED']) {
      await api().post(`/api/v1/admin/orders/shipments/${shipment.id}/status`).set(bearer(t.admin)).send({ status }).expect(200);
    }
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId } });
    expect(inv).toMatchObject({ onHand: 1, reserved: 0 });
    const done = await api().post(`/api/v1/admin/orders/shipments/${shipment.id}/status`).set(bearer(t.admin)).send({ status: 'DELIVERED' }).expect(200);
    expect(done.body.status).toBe('DELIVERED');
    expect(await numbers()).not.toContain(order.body.orderNumber);
    // Support staff can read orders but not move them
    await api().post(`/api/v1/admin/orders/shipments/${shipment.id}/status`).set(bearer(t.support)).send({ status: 'DELIVERED' }).expect(403);
  });

  it('stock adjustments: cannot go below what open orders reserved; every change is in the history', async () => {
    await api().post(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.admin)).send({ delta: -5, reason: 'ADJUSTMENT' }).expect(400);
    await api().post(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.admin)).send({ delta: 9, reason: 'RESTOCK', note: 'Supplier' }).expect(200);
    const hist = await api().get(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.admin)).expect(200);
    expect(hist.body.map((h: { reason: string }) => h.reason)).toEqual(expect.arrayContaining(['RESTOCK', 'COMMIT']));
    const inv = await api().get('/api/v1/admin/inventory').query({ q: `AK-${run}` }).set(bearer(t.admin)).expect(200);
    expect(inv.body.items[0]).toMatchObject({ sku: `AK-${run}`, onHand: 10, available: 10 });
    await api().post(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.support)).send({ delta: 1, reason: 'RESTOCK' }).expect(403);

    // Changing only the low-stock alert level moves no stock and leaves no movement row
    await api().post(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.admin)).send({ delta: 0, reason: 'ADJUSTMENT' }).expect(400);
    await api().post(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.admin)).send({ delta: 0, reason: 'ADJUSTMENT', lowStockThreshold: 3 }).expect(200);
    const after = await prisma.inventory.findUniqueOrThrow({ where: { variantId } });
    expect(after).toMatchObject({ onHand: 10, lowStockThreshold: 3 });
    const hist2 = await api().get(`/api/v1/admin/variants/${variantId}/stock`).set(bearer(t.admin)).expect(200);
    expect(hist2.body).toHaveLength(hist.body.length);
  });

  it('admin panel sessions: staff only, in their own cookie, never mixed with the shop session', async () => {
    const asPanel = (identifier: string, password: string) =>
      api().post('/api/v1/auth/login').set('X-Client-Type', 'admin').send({ identifier, password });
    const denied = await asPanel(`adminflow.${run.toLowerCase()}@fastmovex.test`, 'Buyer-Pass-123');
    expect(denied.status).toBe(403);
    expect(denied.headers['set-cookie']).toBeUndefined();

    const ok = await asPanel('admin@demo.fastmovex.test', DEMO_PASSWORD);
    expect(ok.status).toBe(200);
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/^fmx_admin_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    const pair = cookie.split(';')[0];

    // The shop's refresh endpoint ignores the admin cookie; the panel's refresh accepts it.
    await api().post('/api/v1/auth/refresh').set('Cookie', pair).set('x-requested-with', 'fastmovex-web').send({}).expect(401);
    const refreshed = await api().post('/api/v1/auth/refresh').set('Cookie', pair).set('X-Client-Type', 'admin').set('x-requested-with', 'fastmovex-web').send({});
    expect(refreshed.status).toBe(200);
    expect(String(refreshed.headers['set-cookie'])).toMatch(/^fmx_admin_rt=/);
  });

  it('the audit log names who made each change', async () => {
    const log = await api().get('/api/v1/admin/audit-logs').query({ action: 'product.' }).set(bearer(t.admin)).expect(200);
    const mine = log.body.items.find((l: { entityId: string }) => l.entityId === productId);
    expect(mine).toMatchObject({ actorName: 'Demo Admin' });
    await api().get('/api/v1/admin/audit-logs').set(bearer(t.support)).expect(403);
  });

  it('CSV: export → edit → import updates in place; a dry run changes nothing; bad rows are reported by line', async () => {
    const exp = await api().get('/api/v1/admin/products/export.csv').set(bearer(t.admin)).expect(200);
    const rows = parse(exp.text, { bom: true }) as string[][];
    const header = rows[0];
    const row = rows.find((r) => r.includes(`AK-${run}`))!;
    row[header.indexOf('price')] = '95.50';
    row[header.indexOf('stock')] = '14';
    const edited = toCsv({ title: 'x', columns: header, rows: [row] }); // like saving the file again in a spreadsheet

    const dry = await api().post('/api/v1/admin/products/import').query({ dryRun: 'true' }).set(bearer(t.admin)).attach('file', Buffer.from(edited), 'p.csv').expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, products: { created: 0, updated: 1 }, stockChanges: 1, errors: [] });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).priceMinor).toBe(8900n);

    const real = await api().post('/api/v1/admin/products/import').set(bearer(t.admin)).attach('file', Buffer.from(edited), 'p.csv').expect(200);
    expect(real.body).toMatchObject({ dryRun: false, products: { updated: 1 }, errors: [] });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).priceMinor).toBe(9550n);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).onHand).toBe(14);

    const bad = `handle,sku,title,category,price\nnew-${run},OK-${run},Good title,home-kitchen,10.00\nnew-${run}-b,BAD SKU,x,nowhere,abc\n`;
    const rep = await api().post('/api/v1/admin/products/import').query({ dryRun: 'true' }).set(bearer(t.admin)).attach('file', Buffer.from(bad), 'p.csv').expect(200);
    expect(rep.body.products.created).toBe(1);
    expect(rep.body.errors).toEqual([expect.objectContaining({ line: 3 })]);
  });

  it('dashboard counters show only what the staff member may act on', async () => {
    const admin = await api().get('/api/v1/admin/dashboard/summary').set(bearer(t.admin)).expect(200);
    expect(admin.body).toHaveProperty('shipmentsToFulfil');
    expect(admin.body).toHaveProperty('lowStockVariants');
    const support = await api().get('/api/v1/admin/dashboard/summary').set(bearer(t.support)).expect(200);
    expect(support.body).toHaveProperty('openTickets');
    expect(support.body).not.toHaveProperty('lowStockVariants');
    await api().get('/api/v1/admin/dashboard/summary').set(bearer(t.customer)).expect(403);
  });
});
