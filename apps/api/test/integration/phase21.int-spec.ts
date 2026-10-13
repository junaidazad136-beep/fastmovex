/**
 * PHASE 21 on a real database: the cost price frozen on each sale and the margin report built on it, the drivers' live
 * map and performance, staff tags and notes on customers and orders (never shown to the customer), and staff alerts
 * delivered by permission and by each person's own choice.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { StaffAlertsService } from '../../src/notifications/staff-alerts';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9746${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Phase 21 — insights, notes and staff alerts (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const idOf = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } })).id;

  async function customer(name = 'Maryam Margin') {
    const email = `p21.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: name, email, password: 'Buyer-Pass-123' }).expect(201);
    const addr = await api().post('/api/v1/addresses').set(bearer(reg.body.accessToken)).send({ recipientName: name, phone: phone(), countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '3', lat: 25.3, lng: 51.5, isDefault: true }).expect(201);
    return { token: reg.body.accessToken as string, address: addr.body.id as string, id: await idOf(email) };
  }
  async function order(c: { token: string; address: string }, variant: string, quantity = 1) {
    await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: variant, quantity }).expect(201);
    const r = await api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `p21-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: c.address, paymentMethod: 'COD' }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: r.body.orderNumber }, include: { sellerOrders: { include: { items: true } } } });
    return { orderNumber: o.orderNumber, so: o.sellerOrders[0].id, item: o.sellerOrders[0].items[0] };
  }
  async function product(title: string, priceMinor: string, costPriceMinor: string | undefined, initialStock = 200) {
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title: `${title} ${run}`, titleAr: `${title} ${run}`, categoryId: s.category, variants: [{ sku: `${title.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${run}-${randomBytes(2).toString('hex')}`, priceMinor, ...(costPriceMinor && { costPriceMinor }), initialStock }] }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    return { id: p.body.id as string, variant: p.body.variants[0].id as string };
  }
  /** Alerts are sent after the request (event listeners): wait for them. */
  async function alertsFor(userId: string, type: string, match: string, expected = 1) {
    for (let i = 0; i < 40; i++) {
      const rows = await prisma.notification.findMany({ where: { userId, type, OR: [{ body: { contains: match } }, { title: { contains: match } }] } });
      if (rows.length >= expected) return rows;
      await sleep(100);
    }
    return prisma.notification.findMany({ where: { userId, type, OR: [{ body: { contains: match } }, { title: { contains: match } }] } });
  }

  beforeAll(async () => {
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
    s.adminId = await idOf('admin@demo.fastmovex.test');
    s.opsId = await idOf('ops@demo.fastmovex.test');
    s.financeId = await idOf('finance@demo.fastmovex.test');
    s.courierId = await idOf('courier@demo.fastmovex.test');
    s.category = (await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } })).id;
    // start every staff member on the default alert choices
    await prisma.user.updateMany({ where: { id: { in: [s.adminId, s.opsId, s.financeId] } }, data: { alertPrefs: {} } });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { id: { in: [s.adminId, s.opsId, s.financeId] } }, data: { alertPrefs: {} } });
    await restoreCod?.();
    await sleep(300);
    await app?.close();
  });

  it('cost: frozen on the sale by the database; a later cost change does not move past margins', async () => {
    const p = await product('Margin Mug', '9000', '4000');
    s.marginProduct = p.id;
    const c = await customer();
    const o = await order(c, p.variant, 2);
    expect(o.item.unitCostMinor).toBe(4000n);
    // the variant's cost goes up afterwards
    await prisma.productVariant.update({ where: { id: p.variant }, data: { costPriceMinor: 5000n } });
    const r = (await api().get('/api/v1/admin/reports/margin').query({ range: 'today', group: 'product' }).set(bearer(s.finance)).expect(200)).body;
    const row = r.rows.find((x: { key: string }) => x.key === p.id);
    expect(row).toMatchObject({ units: 2, revenueMinor: '18000', costMinor: '8000', profitMinor: '10000', marginPct: 55.55, uncostedUnits: 0, refundedMinor: '0' });
    // one unit refunded: out of sales and cost, shown as refunded
    await prisma.orderItem.update({ where: { id: o.item.id }, data: { refundedQty: 1 } });
    const r2 = (await api().get('/api/v1/admin/reports/margin').query({ range: 'today', group: 'product' }).set(bearer(s.finance)).expect(200)).body;
    expect(r2.rows.find((x: { key: string }) => x.key === p.id)).toMatchObject({ units: 1, revenueMinor: '9000', costMinor: '4000', profitMinor: '5000', refundedMinor: '9000' });
    // a new sale uses the new cost
    const o2 = await order(c, p.variant, 1);
    expect(o2.item.unitCostMinor).toBe(5000n);
  });

  it('margin: products sold without a cost are left out of the margin and listed; CSV; finance only', async () => {
    const p = await product('No Cost Tray', '600000', undefined); // big enough to lead the "missing cost" list
    const c = await customer('Noura Nocost');
    const o = await order(c, p.variant, 1);
    expect(o.item.unitCostMinor).toBeNull();
    const r = (await api().get('/api/v1/admin/reports/margin').query({ range: 'today', group: 'product' }).set(bearer(s.admin)).expect(200)).body;
    expect(r.rows.find((x: { key: string }) => x.key === p.id)).toMatchObject({ units: 1, revenueMinor: '600000', costMinor: '0', profitMinor: '0', marginPct: null, uncostedUnits: 1 });
    expect(r.missingCost.some((m: { id: string }) => m.id === p.id)).toBe(true);
    expect(BigInt(r.totals.uncostedRevenueMinor)).toBeGreaterThanOrEqual(600000n);
    const byDay = (await api().get('/api/v1/admin/reports/margin').query({ range: 'today' }).set(bearer(s.admin)).expect(200)).body;
    expect(byDay.group).toBe('day');
    expect(byDay.rows).toHaveLength(1);
    const csv = await api().get('/api/v1/admin/reports/margin.csv').query({ range: 'today', group: 'product' }).set(bearer(s.finance)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`Margin Mug ${run}`);
    expect(csv.text.trim().split('\n').pop()).toMatch(/^Total,/);
    await api().get('/api/v1/admin/reports/margin').set(bearer(s.ops)).expect(403); // operations: no margin access
    await api().get('/api/v1/admin/reports/margin').query({ range: 'forever' }).set(bearer(s.admin)).expect(400);
  });

  it('drivers: the live map shows where the driver is and the customer pins; a failed attempt counts and alerts operations', async () => {
    const p = await product('Map Lamp', '7000', '3000');
    const c = await customer('Latifa Live');
    const o = await order(c, p.variant);
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${o.so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    // the delivery job is created right after "ready for pickup", by an event handler: wait for it
    let found = null;
    for (let i = 0; i < 50 && !found; i++) { found = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: o.so } }); if (!found) await new Promise((r) => setTimeout(r, 100)); }
    const job = found!;
    await api().post(`/api/v1/admin/deliveries/${job.id}/assign`).set(bearer(s.admin)).send({ courierUserId: s.courierId }).expect(200);
    await api().post(`/api/v1/courier/jobs/${job.id}/pickup`).set(bearer(s.courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${job.id}/location`).set(bearer(s.courier)).send({ lat: 25.29, lng: 51.53 }).expect(200);

    const live = (await api().get('/api/v1/admin/deliveries/live').set(bearer(s.ops)).expect(200)).body;
    const d = live.drivers.find((x: { id: string }) => x.id === s.courierId);
    expect(d.location).toMatchObject({ lat: 25.29, lng: 51.53, stale: false });
    expect(d.jobs.find((j: { orderNumber: string }) => j.orderNumber === o.orderNumber)).toMatchObject({ status: 'PICKED_UP', pin: { lat: 25.3, lng: 51.5 }, recipient: 'Latifa Live' });
    await api().get('/api/v1/admin/deliveries/live').set(bearer(s.courier)).expect(403);

    const before = (await api().get('/api/v1/admin/deliveries/performance').query({ range: 'today' }).set(bearer(s.ops)).expect(200)).body.drivers.find((x: { id: string }) => x.id === s.courierId);
    await api().post(`/api/v1/courier/jobs/${job.id}/out-for-delivery`).set(bearer(s.courier)).expect(200);
    // marked "not delivered" ~3 km away from the customer's pin
    await api().post(`/api/v1/courier/jobs/${job.id}/fail`).set(bearer(s.courier)).send({ reason: 'Customer not answering', lat: 25.27, lng: 51.52 }).expect(200);
    const after = (await api().get('/api/v1/admin/deliveries/performance').query({ range: 'today' }).set(bearer(s.ops)).expect(200)).body.drivers.find((x: { id: string }) => x.id === s.courierId);
    expect(after.failed).toBe(before.failed + 1);
    expect(after.farFromAddress).toBe(before.farFromAddress + 1);
    expect(typeof after.successPct === 'number' || after.successPct === null).toBe(true);

    // operations (delivery.manage) hear about it; the driver does not; finance has no delivery alerts
    const ops = await alertsFor(s.opsId, 'STAFF_DELIVERY_FAILED', o.orderNumber);
    expect(ops[0].body).toContain('Customer not answering');
    expect(ops.find((n) => n.channel === 'IN_APP' && n.title.includes(o.orderNumber))).toBeTruthy();
    expect((ops[0].data as { link: string }).link).toBe(`/orders/${o.orderNumber}`);
    expect(await prisma.notification.count({ where: { userId: s.courierId, type: 'STAFF_DELIVERY_FAILED', title: { contains: o.orderNumber } } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: s.financeId, type: 'STAFF_DELIVERY_FAILED', title: { contains: o.orderNumber } } })).toBe(0);
  });

  it('tags and notes: staff only, one pinned note shown on the order, never in what the customer sees', async () => {
    const c = await customer('Hind Tagged');
    const p = await product('Tag Vase', '5000', '2000');
    const o = await order(c, p.variant);

    const t = await api().put(`/api/v1/admin/users/${c.id}/tags`).set(bearer(s.admin)).send({ tags: ['vip', ' wholesale', 'VIP', `big spender ${run}`] }).expect(200);
    const big = `BIG_SPENDER_${run.toUpperCase()}`;
    expect(t.body.tags).toEqual(['VIP', 'WHOLESALE', big]);
    await api().put(`/api/v1/admin/users/${c.id}/tags`).set(bearer(s.admin)).send({ tags: ['no!'] }).expect(400);
    await api().put(`/api/v1/admin/users/${c.id}/tags`).set(bearer(s.ops)).send({ tags: ['VIP'] }).expect(403);
    const listed = (await api().get('/api/v1/admin/users').query({ tag: big.toLowerCase() }).set(bearer(s.admin)).expect(200)).body.items;
    expect(listed.map((u: { id: string }) => u.id)).toEqual([c.id]);

    const n1 = (await api().post(`/api/v1/admin/users/${c.id}/notes`).set(bearer(s.admin)).send({ body: `Secret staff note ${run}`, pinned: true }).expect(201)).body;
    const n2 = (await api().post(`/api/v1/admin/users/${c.id}/notes`).set(bearer(s.admin)).send({ body: 'Second note', pinned: true }).expect(201)).body;
    const notes = (await api().get(`/api/v1/admin/users/${c.id}/notes`).set(bearer(s.admin)).expect(200)).body.items;
    expect(notes.filter((n: { pinned: boolean }) => n.pinned).map((n: { id: string }) => n.id)).toEqual([n2.id]); // one pinned at a time
    await api().patch(`/api/v1/admin/users/${c.id}/notes/${n1.id}`).set(bearer(s.admin)).send({ pinned: true }).expect(200);
    await api().post(`/api/v1/admin/users/${c.id}/notes`).set(bearer(s.ops)).send({ body: 'x' }).expect(403); // no users.read
    await api().post(`/api/v1/admin/users/${c.id}/notes`).set(bearer(s.admin)).send({ body: '   ' }).expect(400);

    await api().post(`/api/v1/admin/orders/${o.orderNumber}/notes`).set(bearer(s.ops)).send({ body: 'Leave with the guard' }).expect(201);
    const on = (await api().get(`/api/v1/admin/orders/${o.orderNumber}/notes`).set(bearer(s.ops)).expect(200)).body;
    expect(on.items[0]).toMatchObject({ body: 'Leave with the guard', author: { id: s.opsId } });
    expect(on.customer).toMatchObject({ id: c.id, tags: ['VIP', 'WHOLESALE', big], pinnedNote: { id: n1.id } });
    expect((await api().get(`/api/v1/admin/orders/${o.orderNumber}`).set(bearer(s.ops)).expect(200)).body.user.tags).toContain('VIP');

    // the customer's own views carry none of it
    const mine = JSON.stringify([(await api().get('/api/v1/auth/me').set(bearer(c.token)).expect(200)).body, (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body]);
    expect(mine).not.toContain('Secret staff note');
    expect(mine).not.toContain('Leave with the guard');
    expect(mine).not.toContain('WHOLESALE');

    // only the author or a manager deletes
    await api().delete(`/api/v1/admin/users/${c.id}/notes/${n2.id}`).set(bearer(s.admin)).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: { in: ['customer.tags_set', 'customer.note_add', 'customer.note_pin', 'customer.note_delete'] } } })).toBeGreaterThanOrEqual(5);
  });

  it('alerts: a new order reaches staff with orders.update; each person chooses off, bell or bell + email', async () => {
    await api().patch('/api/v1/me/alert-prefs').set(bearer(s.ops)).send({ prefs: { STAFF_NEW_ORDER: 'email', NOT_A_TYPE: 'email' } }).expect(200);
    const offPrefs = (await api().patch('/api/v1/me/alert-prefs').set(bearer(s.admin)).send({ prefs: { STAFF_NEW_ORDER: 'off', STAFF_LOW_STOCK: 'loud' } }).expect(200)).body;
    expect(offPrefs.alerts.find((a: { type: string }) => a.type === 'STAFF_NEW_ORDER').mode).toBe('off');
    expect(offPrefs.alerts.find((a: { type: string }) => a.type === 'STAFF_LOW_STOCK').mode).toBe('app'); // unknown mode ignored
    // finance sees only the alerts their permissions allow
    const fin = (await api().get('/api/v1/me/alert-prefs').set(bearer(s.finance)).expect(200)).body.alerts.map((a: { type: string }) => a.type);
    expect(fin).toContain('STAFF_REFUND_PENDING');
    expect(fin).not.toContain('STAFF_NEW_ORDER');

    const c = await customer('Amal Alert');
    await api().put(`/api/v1/admin/users/${c.id}/tags`).set(bearer(s.admin)).send({ tags: ['VIP'] }).expect(200);
    const p = await product('Alert Bowl', '4000', '1000');
    const o = await order(c, p.variant);
    const ops = await alertsFor(s.opsId, 'STAFF_NEW_ORDER', o.orderNumber, 2);
    expect(ops.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(ops[0].title).toBe(`New order ${o.orderNumber}`);
    expect(ops[0].body).toContain('[VIP]');
    await sleep(300);
    expect(await prisma.notification.count({ where: { userId: s.adminId, type: 'STAFF_NEW_ORDER', title: { contains: o.orderNumber } } })).toBe(0); // switched off
    expect(await prisma.notification.count({ where: { userId: s.financeId, type: 'STAFF_NEW_ORDER', title: { contains: o.orderNumber } } })).toBe(0); // no orders.update
    // the bell reads them like any notification
    const inbox = (await api().get('/api/v1/me/notifications').set(bearer(s.ops)).expect(200)).body.items;
    expect(inbox.some((n: { type: string; data: { link: string } }) => n.type === 'STAFF_NEW_ORDER' && n.data.link === `/orders/${o.orderNumber}`)).toBe(true);
  });

  it('low stock: announced once to inventory staff, again only after a restock and a new drop', async () => {
    const p = await product('Low Jar', '3000', '1000', 3); // alert level 5
    // anything else already low counts as announced, so this run's alert lists only our jar
    await prisma.inventory.updateMany({ where: { lowStockAlertedAt: null, variantId: { not: p.variant } }, data: { lowStockAlertedAt: new Date() } });
    const alerts = app.get(StaffAlertsService);
    await alerts.scanLowStock();
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { variantId: p.variant } });
    expect(inv.lowStockAlertedAt).not.toBeNull();
    const first = await alertsFor(s.opsId, 'STAFF_LOW_STOCK', `Low Jar ${run}`);
    expect(first).toHaveLength(1);
    await alerts.scanLowStock();
    expect(await prisma.notification.count({ where: { userId: s.opsId, type: 'STAFF_LOW_STOCK', body: { contains: `Low Jar ${run}` } } })).toBe(1);
    // restocked above the level: cleared, then falls again → announced again
    const stock = (onHand: number) => prisma.warehouseStock.updateMany({ where: { variantId: p.variant }, data: { onHand } });
    await stock(50);
    await alerts.scanLowStock();
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: p.variant } })).lowStockAlertedAt).toBeNull();
    await stock(2);
    await alerts.scanLowStock();
    expect(await prisma.notification.count({ where: { userId: s.opsId, type: 'STAFF_LOW_STOCK', body: { contains: `Low Jar ${run}` } } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: s.financeId, type: 'STAFF_LOW_STOCK', body: { contains: `Low Jar ${run}` } } })).toBe(0);
  });
});
