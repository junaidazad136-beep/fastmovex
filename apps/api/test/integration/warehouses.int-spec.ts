/**
 * Several warehouses on a real database: the shop's total always equals the sum of the shelves (database trigger,
 * direct edits refused), checkout picks the warehouse that has everything and is nearest, staff can change it,
 * shipping takes units off that shelf (never below zero), transfers move units without changing the total.
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
const run = randomBytes(3).toString('hex').toUpperCase();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Warehouses — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const shelf = async (warehouseId: string) => (await prisma.warehouseStock.findUnique({ where: { warehouseId_variantId: { warehouseId, variantId: s.variant } } }))?.onHand ?? 0;
  const total = async () => (await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } })).onHand;
  const sumOfShelves = async () => (await prisma.warehouseStock.aggregate({ where: { variantId: s.variant }, _sum: { onHand: true } }))._sum.onHand ?? 0;

  async function order(zone: string, quantity: number) {
    const cart = await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity }).expect(201);
    const res = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart.body.cartToken).set('Idempotency-Key', `wh-${run}-${randomBytes(4).toString('hex')}`).send({
      contact: { fullName: 'Warehouse Guest', email: `wh.${run.toLowerCase()}@example.com`, phone: '+97455512311' },
      address: { recipientName: 'Warehouse Guest', phone: '+97455512311', city: 'Doha', zone, street: '901', building: '12' }, paymentMethod: 'COD',
    }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.orderNumber }, include: { sellerOrders: true } });
    return o.sellerOrders[0];
  }
  const status = (shipment: string, to: string) => api().post(`/api/v1/admin/orders/shipments/${shipment}/status`).set(bearer(s.admin)).send({ status: to });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF' }); // not what this file tests
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined);
    s.admin = (await api().post('/api/v1/auth/login').send({ identifier: 'admin@demo.jovia.test', password: DEMO_PASSWORD }).expect(200)).body.accessToken;
  });

  afterAll(async () => { await restoreCod?.();
    // leave the extra warehouse closed and empty so other tests keep using the main one
    if (s.wak) {
      await prisma.sellerOrder.updateMany({ where: { warehouseId: s.wak }, data: { warehouseId: s.main } }).catch(() => undefined);
      const left = await prisma.warehouseStock.findMany({ where: { warehouseId: s.wak, onHand: { gt: 0 } } });
      for (const r of left) {
        await prisma.$transaction([
          prisma.warehouseStock.update({ where: { warehouseId_variantId: { warehouseId: s.main, variantId: r.variantId } }, data: { onHand: { increment: r.onHand } } }),
          prisma.warehouseStock.update({ where: { warehouseId_variantId: { warehouseId: s.wak, variantId: r.variantId } }, data: { onHand: 0 } }),
        ]).catch(() => undefined);
      }
      await prisma.warehouse.update({ where: { id: s.wak }, data: { isActive: false } }).catch(() => undefined);
    }
    await app?.close();
  });

  it('every store starts with a main warehouse holding its stock; new stock lands there', async () => {
    const list = (await api().get('/api/v1/admin/warehouses').set(bearer(s.admin)).expect(200)).body;
    const main = list.items.find((w: { isDefault: boolean }) => w.isDefault);
    expect(main).toMatchObject({ code: 'MAIN', isActive: true });
    s.main = main.id;

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({
      title: `Warehouse Lamp ${run}`, categoryId: cat.id, variants: [{ sku: `WH-${run}`, priceMinor: '5000', initialStock: 10 }],
    }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
    expect(await shelf(s.main)).toBe(10);
    expect(await total()).toBe(10);
  });

  it('the total can only follow the shelves: changing it directly is refused by the database', async () => {
    await expect(prisma.$executeRaw`UPDATE "Inventory" SET "onHand" = 999 WHERE "variantId" = ${s.variant}::uuid`).rejects.toThrow(/sum of the warehouses/);
    expect(await total()).toBe(10);
  });

  it('staff add a warehouse and put stock in it', async () => {
    await api().post('/api/v1/admin/warehouses').set(bearer(s.admin)).send({ code: 'main', name: 'Duplicate' }).expect(409);
    await api().post('/api/v1/admin/warehouses').set(bearer(s.admin)).send({ code: 'x', name: 'Too short code' }).expect(400);
    const w = await api().post('/api/v1/admin/warehouses').set(bearer(s.admin)).send({ code: `WAK${run}`.slice(0, 20), name: 'Al Wakrah store room', city: 'Al Wakrah', zones: ['90', '91'], priority: 150 }).expect(201);
    s.wak = w.body.id;
    await api().post(`/api/v1/admin/variants/${s.variant}/stock`).set(bearer(s.admin)).send({ delta: 6, reason: 'RESTOCK', warehouseId: s.wak }).expect(200);
    await api().post(`/api/v1/admin/variants/${s.variant}/stock`).set(bearer(s.admin)).send({ delta: -7, reason: 'ADJUSTMENT', warehouseId: s.wak }).expect(409); // only 6 there
    expect([await shelf(s.main), await shelf(s.wak), await total()]).toEqual([10, 6, 16]);
    const per = (await api().get(`/api/v1/admin/variants/${s.variant}/warehouses`).set(bearer(s.admin)).expect(200)).body;
    expect(per.map((x: { id: string; onHand: number }) => [x.id, x.onHand])).toEqual(expect.arrayContaining([[s.main, 10], [s.wak, 6]]));
  });

  it('checkout picks the warehouse that has everything, nearest to the customer', async () => {
    const near = await order('90', 2); // Al Wakrah zone: the Wakrah room has it
    expect(near.warehouseId).toBe(s.wak);
    const far = await order('25', 2); // elsewhere: both have it, the main one comes first (priority)
    expect(far.warehouseId).toBe(s.main);
    const big = await order('90', 6); // Wakrah has only 4 left free (2 are held for the first order): main sends it
    expect(big.warehouseId).toBe(s.main);
    s.near = near.id; s.big = big.id; s.far = far.id;
  });

  it('staff see whether the warehouse has everything, and can send from another one', async () => {
    const before = (await api().get(`/api/v1/admin/orders/shipments/${s.big}/warehouse`).set(bearer(s.admin)).expect(200)).body;
    expect(before.warehouseId).toBe(s.main);
    expect(before.options.find((o: { id: string }) => o.id === s.wak)).toMatchObject({ hasEverything: false, short: [expect.objectContaining({ need: 6, free: 4 })] });
    const after = (await api().post(`/api/v1/admin/orders/shipments/${s.big}/warehouse`).set(bearer(s.admin)).send({ warehouseId: s.wak }).expect(200)).body;
    expect(after.warehouseId).toBe(s.wak);
    // three get damaged in Wakrah: now it really has too few, and shipping fails instead of going below zero
    await api().post(`/api/v1/admin/variants/${s.variant}/stock`).set(bearer(s.admin)).send({ delta: -3, reason: 'ADJUSTMENT', note: 'Damaged', warehouseId: s.wak }).expect(200);
    await status(s.big, 'PREPARING').expect(200);
    const fail = await status(s.big, 'SHIPPED').expect(409);
    expect(fail.body.reason).toBe('WAREHOUSE_SHORT');
    expect(fail.body.message).toContain('Al Wakrah store room');
    expect([await shelf(s.wak), await total()]).toEqual([3, 13]);
  });

  it('a transfer moves units between warehouses without changing the total', async () => {
    const tooMany = await api().post('/api/v1/admin/stock-transfers').set(bearer(s.admin)).send({ fromWarehouseId: s.main, toWarehouseId: s.wak, items: [{ variantId: s.variant, quantity: 50 }] });
    expect(tooMany.status).toBe(400);
    await api().post('/api/v1/admin/stock-transfers').set(bearer(s.admin)).send({ fromWarehouseId: s.main, toWarehouseId: s.main, items: [{ variantId: s.variant, quantity: 1 }] }).expect(400);
    const t = await api().post('/api/v1/admin/stock-transfers').set(bearer(s.admin)).send({ fromWarehouseId: s.main, toWarehouseId: s.wak, items: [{ variantId: s.variant, quantity: 4 }], note: 'For order to Wakrah' }).expect(201);
    expect(t.body.number).toMatch(/^TR-\d{6}-[0-9A-F]{4}$/);
    expect([await shelf(s.main), await shelf(s.wak)]).toEqual([10, 3]); // nothing moves until it arrives
    await api().post(`/api/v1/admin/stock-transfers/${t.body.id}/receive`).set(bearer(s.admin)).expect(200);
    await api().post(`/api/v1/admin/stock-transfers/${t.body.id}/receive`).set(bearer(s.admin)).expect(409); // only once
    expect([await shelf(s.main), await shelf(s.wak), await total()]).toEqual([6, 7, 13]);

    const cancelled = await api().post('/api/v1/admin/stock-transfers').set(bearer(s.admin)).send({ fromWarehouseId: s.wak, toWarehouseId: s.main, items: [{ variantId: s.variant, quantity: 1 }] }).expect(201);
    await api().post(`/api/v1/admin/stock-transfers/${cancelled.body.id}/cancel`).set(bearer(s.admin)).expect(200);
    await api().post(`/api/v1/admin/stock-transfers/${cancelled.body.id}/receive`).set(bearer(s.admin)).expect(409);
    const list = (await api().get('/api/v1/admin/stock-transfers').set(bearer(s.admin)).expect(200)).body.items;
    expect(list.find((x: { id: string }) => x.id === t.body.id)).toMatchObject({ status: 'RECEIVED', items: [expect.objectContaining({ quantity: 4, sku: `WH-${run}` })] });
  });

  it('shipping takes the units off that warehouse shelf; the totals always add up', async () => {
    await status(s.big, 'SHIPPED').expect(200);
    expect([await shelf(s.main), await shelf(s.wak), await total()]).toEqual([6, 1, 7]);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } });
    expect(inv.reserved).toBe(4); // the other two orders still hold theirs
    const moves = await prisma.inventoryMovement.findMany({ where: { variantId: s.variant, reason: 'COMMIT' } });
    expect(moves).toEqual([expect.objectContaining({ warehouseId: s.wak, qtyDelta: -6 })]);
    expect(await total()).toBe(await sumOfShelves());
  });

  it('a warehouse with stock or open shipments cannot be closed; the default cannot be closed at all', async () => {
    await api().patch(`/api/v1/admin/warehouses/${s.wak}`).set(bearer(s.admin)).send({ isActive: false }).expect(400);
    await api().patch(`/api/v1/admin/warehouses/${s.main}`).set(bearer(s.admin)).send({ isActive: false }).expect(400);
    await api().patch(`/api/v1/admin/warehouses/${s.main}`).set(bearer(s.admin)).send({ isDefault: false }).expect(400);
    const list = (await api().get('/api/v1/admin/warehouses').set(bearer(s.admin)).expect(200)).body.items;
    expect(list.find((w: { id: string }) => w.id === s.wak)).toMatchObject({ units: 1, openShipments: 1 });
    // a customer cannot see any of it
    const buyer = (await api().post('/api/v1/auth/register').send({ fullName: 'WH Buyer', email: `wh.b.${run.toLowerCase()}@jovia.test`, password: 'Buyer-Pass-123' }).expect(201)).body.accessToken;
    await api().get('/api/v1/admin/warehouses').set(bearer(buyer)).expect(403);
  });
});
