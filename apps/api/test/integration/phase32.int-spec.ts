/**
 * PHASE 32 on a real database: the Seller Center's returns, questions, reviews and coupons pages, and the "to do"
 * counts on the seller home. A real cash order from the Gadgets store is delivered, then returned.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');

describe('Phase 32 — Seller Center pages (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const s: Record<string, string> = {};

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    s.admin = await login('admin@demo.fastmovex.test');
    s.gadgets = await login('seller.gadgets@demo.fastmovex.test');
    s.oud = await login('seller.oud@demo.fastmovex.test');
    // a new customer (returns are limited per customer per hour)
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Phase Tester', email: `p32.${run}@fastmovex.test`, password: 'Buyer-Pass-123' }).expect(201);
    s.customer = reg.body.accessToken;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('a delivered item is returned: the seller sees it (no customer ids), approves, and takes it back as damaged', async () => {
    const before = (await api().get('/api/v1/seller/orders/summary').set(bearer(s.gadgets)).expect(200)).body.todo;
    const address = (await api().post('/api/v1/addresses').set(bearer(s.customer)).send({ recipientName: 'Phase Tester', phone: `+9745${String(1_000_000 + Math.floor(Math.random() * 8_999_999))}`, countryCode: 'QA', city: 'Doha', zone: '66', street: '901', building: '12', isDefault: true }).expect(201)).body.id;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { sku: 'NPC20K' } });
    await api().post('/api/v1/cart/items').set(bearer(s.customer)).send({ variantId: variant.id, quantity: 1 }).expect(201);
    const order = (await api().post('/api/v1/checkout').set(bearer(s.customer)).set('Idempotency-Key', `p32-${run}`).send({ addressId: address, paymentMethod: 'COD' }).expect(201)).body;
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: order.orderNumber }, include: { sellerOrders: { include: { items: true } } } });
    const so = o.sellerOrders[0];
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${so.id}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    for (let i = 0; i < 50 && !(await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: so.id } })); i++) await new Promise((r) => setTimeout(r, 100));
    await api().post(`/api/v1/admin/orders/shipments/${so.id}/status`).set(bearer(s.admin)).send({ status: 'SHIPPED' }).expect(200);
    await api().post(`/api/v1/admin/orders/shipments/${so.id}/status`).set(bearer(s.admin)).send({ status: 'DELIVERED', overrideReason: 'Collected at the warehouse counter' }).expect(200);
    const ret = (await api().post(`/api/v1/orders/${order.orderNumber}/returns`).set(bearer(s.customer)).send({ orderItemId: so.items[0].id, quantity: 1, reason: 'Stopped charging after a day' }).expect(201)).body;

    const after = (await api().get('/api/v1/seller/orders/summary').set(bearer(s.gadgets)).expect(200)).body.todo;
    expect(after.returns).toBe(before.returns + 1);
    const list = (await api().get('/api/v1/seller/returns').query({ status: 'REQUESTED' }).set(bearer(s.gadgets)).expect(200)).body.items;
    const mine = list.find((r: { id: string }) => r.id === ret.id);
    expect(mine).toMatchObject({ status: 'REQUESTED', quantity: 1, reason: 'Stopped charging after a day', images: [] });
    expect(mine.orderItem).toMatchObject({ sku: 'NPC20K', order: { orderNumber: order.orderNumber } });
    expect(typeof mine.orderItem.unitPriceMinor).toBe('string');
    expect(mine.userId).toBeUndefined();
    expect(mine.reviewedById).toBeUndefined();
    // another store cannot see or act on it
    expect((await api().get('/api/v1/seller/returns').set(bearer(s.oud)).expect(200)).body.items.some((r: { id: string }) => r.id === ret.id)).toBe(false);
    await api().post(`/api/v1/seller/returns/${ret.id}/decision`).set(bearer(s.oud)).send({ decision: 'APPROVED' }).expect(404);

    await api().post(`/api/v1/seller/returns/${ret.id}/decision`).set(bearer(s.gadgets)).send({ decision: 'APPROVED' }).expect(200);
    await api().post(`/api/v1/seller/returns/${ret.id}/received`).set(bearer(s.gadgets)).send({ condition: 'DAMAGED' }).expect(400); // what was wrong?
    const back = await api().post(`/api/v1/seller/returns/${ret.id}/received`).set(bearer(s.gadgets)).send({ condition: 'DAMAGED', note: 'Cracked case' }).expect(200);
    expect(back.body).toMatchObject({ status: 'RECEIVED', condition: 'DAMAGED', inspectionNote: 'Cracked case' });
  });

  it('a question waits on the seller home; the seller answers it', async () => {
    const before = (await api().get('/api/v1/seller/orders/summary').set(bearer(s.gadgets)).expect(200)).body.todo.questions;
    const q = (await api().post('/api/v1/products/nova-powercore-20000-power-bank/questions').set(bearer(s.customer)).send({ body: `Does it charge a laptop? ${run}` }).expect(201)).body;
    expect((await api().get('/api/v1/seller/orders/summary').set(bearer(s.gadgets)).expect(200)).body.todo.questions).toBe(before + 1);
    const waiting = (await api().get('/api/v1/seller/questions').query({ status: 'PENDING' }).set(bearer(s.gadgets)).expect(200)).body.items;
    expect(waiting.some((x: { id: string }) => x.id === q.id)).toBe(true);
    await api().post(`/api/v1/seller/questions/${q.id}/answer`).set(bearer(s.gadgets)).send({ answer: 'Yes, laptops with USB-C charging.' }).expect(200);
    expect((await api().get('/api/v1/seller/orders/summary').set(bearer(s.gadgets)).expect(200)).body.todo.questions).toBe(before);
  });

  it('reviews come with a summary on the first page and can be filtered by stars', async () => {
    const all = (await api().get('/api/v1/seller/reviews').set(bearer(s.gadgets)).expect(200)).body;
    expect(all.summary.byStar).toHaveLength(5);
    expect(all.summary.count).toBe(all.summary.byStar.reduce((a: number, b: number) => a + b, 0));
    const five = (await api().get('/api/v1/seller/reviews').query({ rating: 5 }).set(bearer(s.gadgets)).expect(200)).body;
    expect(five.items.every((r: { rating: number }) => r.rating === 5)).toBe(true);
  });

  it("a store's coupon is its own, paid by the store", async () => {
    const c = (await api().post('/api/v1/seller/coupons').set(bearer(s.gadgets)).send({
      code: `GAD${run}`.toUpperCase(), type: 'PERCENTAGE', valueBps: 1500, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), perUserLimit: 1,
    }).expect(201)).body;
    expect(c).toMatchObject({ scope: 'SELLER', fundedBy: 'SELLER', isActive: true });
    await api().patch(`/api/v1/seller/coupons/${c.id}`).set(bearer(s.oud)).send({ isActive: false }).expect(404);
    expect((await api().patch(`/api/v1/seller/coupons/${c.id}`).set(bearer(s.gadgets)).send({ isActive: false }).expect(200)).body.isActive).toBe(false);
  });

  it("a seller's spreadsheet: checked first, then saved into their own store only", async () => {
    const oudProduct = await prisma.product.findFirstOrThrow({ where: { deletedAt: null, store: { seller: { owner: { email: 'seller.oud@demo.fastmovex.test' } } } } });
    const csv = (rows: string[][]) => Buffer.from(['handle,title,category,brand,sku,option1_name,option1_value,price,stock,status', ...rows.map((r) => r.join(','))].join('\n'));
    const file = csv([
      [`mug-${run}`, `Travel Mug ${run}`, 'electronics', '', `MUG-B-${run}`, 'Colour', 'Black', '45.00', '10', 'draft'],
      [`mug-${run}`, '', '', '', `MUG-W-${run}`, 'Colour', 'White', '45.00', '8', ''],
      [`bad-${run}`, `Bad brand ${run}`, 'electronics', 'NoSuchBrand', `BAD-${run}`, '', '', '10', '1', ''],
    ]);
    const check = (await api().post('/api/v1/seller/products/import').query({ dryRun: 'true' }).set(bearer(s.gadgets)).attach('file', file, 'p.csv').expect(200)).body;
    expect(check).toMatchObject({ dryRun: true, products: { created: 1 }, variants: { created: 2 } });
    expect(check.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('brand "NoSuchBrand" is not on FastMoveX') })]);
    expect(await prisma.product.count({ where: { title: `Travel Mug ${run}` } })).toBe(0);

    const saved = (await api().post('/api/v1/seller/products/import').set(bearer(s.gadgets)).attach('file', file, 'p.csv').expect(200)).body;
    expect(saved.dryRun).toBe(false);
    const mug = await prisma.product.findFirstOrThrow({ where: { title: `Travel Mug ${run}` }, include: { store: { include: { seller: { include: { owner: true } } } }, variants: { include: { inventory: true } } } });
    expect(mug.store.seller.owner.email).toBe('seller.gadgets@demo.fastmovex.test');
    expect(mug.status).toBe('DRAFT');
    expect(mug.variants.map((v) => v.inventory?.onHand).sort()).toEqual([10, 8].sort());

    // the store's own export has its products and no one else's
    const exp = (await api().get('/api/v1/seller/products/export.csv').set(bearer(s.gadgets)).expect(200)).text;
    expect(exp).toContain(`MUG-B-${run}`);
    expect(exp).not.toContain(oudProduct.slug);
    // re-importing a changed stock updates it
    const again = (await api().post('/api/v1/seller/products/import').set(bearer(s.gadgets)).attach('file', csv([[`mug-${run}`, '', '', '', `MUG-B-${run}`, 'Colour', 'Black', '49.00', '25', '']]), 'p.csv').expect(200)).body;
    expect(again).toMatchObject({ products: { updated: 1 }, stockChanges: 1, errors: [] });
    const black = await prisma.productVariant.findFirstOrThrow({ where: { sku: `MUG-B-${run}` }, include: { inventory: true } });
    expect([black.priceMinor, black.inventory?.onHand]).toEqual([4900n, 25]);
  });
});
