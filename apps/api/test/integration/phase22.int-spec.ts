/**
 * PHASE 22 on a real database: changing an order after checkout (staff: items, address, window; the customer: window
 * and address before packing), phone orders, items refused at the door, return pickups by a driver, and each staff
 * member's refund approval limit.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { OrderAccessService } from '../../src/common/order-access.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9746${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Phase 22 — order changes, phone orders, door refusals, pickups, refund limits (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  let slotsBefore: unknown;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const idOf = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } })).id;

  async function customer(name = 'Reem Changes') {
    const email = `p22.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: name, email, password: 'Buyer-Pass-123' }).expect(201);
    const t = reg.body.accessToken as string;
    const a1 = await api().post('/api/v1/addresses').set(bearer(t)).send({ recipientName: name, phone: phone(), countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '3', isDefault: true, lat: 25.3, lng: 51.5 }).expect(201);
    const a2 = await api().post('/api/v1/addresses').set(bearer(t)).send({ label: 'Work', recipientName: name, phone: phone(), countryCode: 'QA', city: 'Doha', zone: '25', street: '230', building: '41' }).expect(201);
    return { token: t, address: a1.body.id as string, other: a2.body.id as string, id: await idOf(email) };
  }
  async function order(c: { token: string; address: string }, lines: { variant: string; quantity: number }[], paymentMethod: 'COD' | 'CARD' = 'COD') {
    for (const l of lines) await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: l.variant, quantity: l.quantity }).expect(201);
    const r = await api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `p22-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: c.address, paymentMethod }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: r.body.orderNumber }, include: { sellerOrders: { include: { items: { orderBy: { productTitle: 'asc' } } } }, payments: true } });
    return { orderNumber: o.orderNumber, id: o.id, so: o.sellerOrders[0].id, items: o.sellerOrders[0].items };
  }
  async function product(title: string, priceMinor: string, stock = 100) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title: `${title} ${run}`, titleAr: `${title} ${run}`, categoryId: cat.id, variants: [{ sku: `P22-${title.replace(/\W/g, '').slice(0, 4).toUpperCase()}-${run}`, priceMinor, initialStock: stock }] }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    return p.body.variants[0].id as string;
  }
  const reserved = async (variantId: string) => (await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reserved;
  async function onTheRoad(o: { so: string }) {
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${o.so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    let d = null;
    for (let i = 0; i < 50 && !d; i++) { d = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: o.so } }); if (!d) await sleep(100); }
    await api().post(`/api/v1/admin/deliveries/${d!.id}/assign`).set(bearer(s.admin)).send({ courierUserId: s.courierId }).expect(200);
    await api().post(`/api/v1/courier/jobs/${d!.id}/pickup`).set(bearer(s.courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${d!.id}/out-for-delivery`).set(bearer(s.courier)).expect(200);
    return d!.id;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 5, driverCashLimitMinor: null });
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined as never);
    slotsBefore = (await prisma.country.findUniqueOrThrow({ where: { code: 'QA' } })).deliverySlots;
    s.admin = await login('admin@demo.jovia.test');
    s.ops = await login('ops@demo.jovia.test');
    s.finance = await login('finance@demo.jovia.test');
    s.finance2 = await login('finance2@demo.jovia.test');
    s.courier = await login('courier@demo.jovia.test');
    s.owner = await login('owner@jovia.test', 'Owner-Pass-2026');
    s.adminId = await idOf('admin@demo.jovia.test');
    s.financeId = await idOf('finance@demo.jovia.test');
    s.finance2Id = await idOf('finance2@demo.jovia.test');
    s.courierId = await idOf('courier@demo.jovia.test');
    s.mug = await product('Change Mug', '4000');
    s.bowl = await product('Change Bowl', '2500');
  });

  afterAll(async () => {
    await prisma?.user.updateMany({ where: { id: { in: [s.financeId, s.finance2Id].filter(Boolean) } }, data: { refundLimitMinor: null } });
    await prisma?.country.update({ where: { code: 'QA' }, data: { deliverySlots: (slotsBefore ?? {}) as object } }).catch(() => undefined);
    await restoreCod?.();
    await sleep(300);
    await app?.close();
  });

  it('staff reduce and remove items before dispatch: stock, totals, cash to collect, record and message follow', async () => {
    const c = await customer();
    const before = { mug: await reserved(s.mug), bowl: await reserved(s.bowl) };
    const o = await order(c, [{ variant: s.mug, quantity: 3 }, { variant: s.bowl, quantity: 1 }]);
    const [bowl, mug] = o.items; // ordered by title
    expect(await reserved(s.mug)).toBe(before.mug + 3);
    // only reductions; never everything; a reason is required; finance cannot
    await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ changes: [{ itemId: mug.id, quantity: 4 }], reason: 'more please' }).expect(400);
    await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ changes: [{ itemId: mug.id, quantity: 0 }, { itemId: bowl.id, quantity: 0 }], reason: 'remove all of it' }).expect(400);
    await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ changes: [{ itemId: mug.id, quantity: 1 }], reason: 'x' }).expect(400);
    await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.finance)).send({ changes: [{ itemId: mug.id, quantity: 1 }], reason: 'Customer called' }).expect(403);

    const r = await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ changes: [{ itemId: mug.id, quantity: 1 }, { itemId: bowl.id, quantity: 0 }], reason: 'Customer called: one mug only' }).expect(200);
    expect(r.body.amountMinor).toBe('10500');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { sellerOrders: { include: { items: true } }, payments: true, changes: true } });
    expect(after.subtotalMinor).toBe(4000n);
    expect(after.payments[0].amountMinor).toBe(after.totalMinor); // cash to collect follows
    expect(after.sellerOrders[0].subtotalMinor).toBe(4000n);
    const items = new Map(after.sellerOrders[0].items.map((i) => [i.id, i]));
    expect(items.get(mug.id)).toMatchObject({ quantity: 1, lineTotalMinor: 4000n, status: 'CONFIRMED' });
    expect(items.get(bowl.id)).toMatchObject({ quantity: 1, status: 'CANCELLED' });
    expect(await reserved(s.mug)).toBe(before.mug + 1);
    expect(await reserved(s.bowl)).toBe(before.bowl);
    expect(after.changes).toHaveLength(1);
    expect(after.changes[0]).toMatchObject({ kind: 'ITEMS', byRole: 'STAFF', amountMinor: 10500n, reason: 'Customer called: one mug only' });
    // the change record is permanent
    await expect(prisma.orderChange.update({ where: { id: after.changes[0].id }, data: { summary: 'edited' } })).rejects.toThrow();
    // customer sees what changed (no staff names, no reason), and is told
    const view = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(view.changes[0]).toEqual({ kind: 'ITEMS', byRole: 'STAFF', summary: expect.stringContaining('removed'), amountMinor: '10500', createdAt: expect.any(String) });
    expect(JSON.stringify(view)).not.toContain('unitCostMinor');
    expect(await prisma.notification.count({ where: { userId: c.id, type: 'ORDER_CHANGED' } })).toBeGreaterThan(0);
    // the removed line stays off the shipment from here on (shipping commits only what is left)
    await api().post(`/api/v1/admin/orders/shipments/${o.so}/status`).set(bearer(s.admin)).send({ status: 'PREPARING' }).expect(200);
    await api().post(`/api/v1/admin/orders/shipments/${o.so}/status`).set(bearer(s.admin)).send({ status: 'SHIPPED' }).expect(200);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: bowl.id } })).status).toBe('CANCELLED');
    expect(await reserved(s.mug)).toBe(before.mug);
    // shipped: no more changes
    await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.ops)).send({ changes: [{ itemId: mug.id, quantity: 0 }], reason: 'too late now' }).expect(409);
    await api().put(`/api/v1/admin/orders/${o.orderNumber}/address`).set(bearer(s.ops)).send({ addressId: c.other }).expect(409);
  });

  it('a card order changed by staff gets a refund for the difference (normal approval)', async () => {
    const c = await customer('Card Changer');
    const o = await order(c, [{ variant: s.mug, quantity: 2 }], 'CARD');
    const r = await api().patch(`/api/v1/admin/orders/${o.orderNumber}/items`).set(bearer(s.admin)).send({ changes: [{ itemId: o.items[0].id, quantity: 1 }], reason: 'Out of the gift box' }).expect(200);
    expect(r.body.refunds).toHaveLength(1);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: r.body.refunds[0] } });
    expect(refund).toMatchObject({ status: 'PENDING', amountMinor: 4000n, sellerOrderId: o.so, createdById: s.adminId });
    s.cardRefund = refund.id;
  });

  it('refund limit: above a person’s limit they cannot approve; someone without one can', async () => {
    await api().put(`/api/v1/admin/staff/${s.financeId}/refund-limit`).set(bearer(s.owner)).send({ limitMinor: '3000' }).expect(200);
    await api().put(`/api/v1/admin/staff/${s.financeId}/refund-limit`).set(bearer(s.admin)).send({ limitMinor: '9000' }).expect(403); // admins.manage only
    const me = (await api().get('/api/v1/auth/me').set(bearer(s.finance)).expect(200)).body;
    expect(me.refundLimitMinor).toBe('3000');
    const no = await api().post(`/api/v1/admin/refunds/${s.cardRefund}/approve`).set(bearer(s.finance)).expect(403);
    expect(no.body.reason).toBe('REFUND_LIMIT');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: s.cardRefund } })).status).toBe('PENDING');
    await api().post(`/api/v1/admin/refunds/${s.cardRefund}/approve`).set(bearer(s.finance2)).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'staff.refund_limit', entityId: s.financeId } })).toBeGreaterThan(0);
  });

  it('the customer moves the delivery window or address before packing; guests with their link; limited and closed after packing', async () => {
    await prisma.country.update({ where: { code: 'QA' }, data: { deliverySlots: { enabled: true, required: false, daysAhead: 4, leadMinutes: 0, closedWeekdays: [], closedDates: [], windows: [{ start: '08:00', end: '14:00', capacity: 500 }, { start: '14:00', end: '22:00', capacity: 500 }] } } });
    const c = await customer('Window Mover');
    const o = await order(c, [{ variant: s.bowl, quantity: 1 }]);
    const slots = (await api().get('/api/v1/delivery/slots').expect(200)).body;
    const open = slots.days.flatMap((d: { slots: { start: string; available: boolean }[] }) => d.slots).filter((x: { available: boolean }) => x.available);
    const usage = async (start: string) => (await prisma.deliverySlotUsage.findUnique({ where: { countryCode_slotStart: { countryCode: 'QA', slotStart: new Date(start) } } }))?.booked ?? 0;
    const before = await usage(open[1].start);
    await api().put(`/api/v1/orders/${o.orderNumber}/slot`).set(bearer(c.token)).send({ deliverySlot: open[1].start }).expect(200);
    expect(await usage(open[1].start)).toBe(before + 1);
    const b2 = await usage(open[0].start);
    await api().put(`/api/v1/orders/${o.orderNumber}/slot`).set(bearer(c.token)).send({ deliverySlot: open[0].start }).expect(200);
    expect(await usage(open[1].start)).toBe(before); // the old place is given back
    expect(await usage(open[0].start)).toBe(b2 + 1);
    // someone else's address or order: not found (and not counted as a change)
    const other = await customer('Other Person');
    await api().put(`/api/v1/orders/${o.orderNumber}/address`).set(bearer(c.token)).send({ addressId: other.address }).expect(404);
    await api().put(`/api/v1/orders/${o.orderNumber}/slot`).set(bearer(other.token)).send({ deliverySlot: open[1].start }).expect(404);
    await api().put(`/api/v1/orders/${o.orderNumber}/address`).set(bearer(c.token)).send({ addressId: c.other }).expect(200);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect((saved.shippingAddress as { zone: string; addressId: string })).toMatchObject({ zone: '25', addressId: c.other });
    // three changes per order
    let view = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(view.changeOptions).toEqual({ canChange: false, changesLeft: 0 });
    const limit = await api().put(`/api/v1/orders/${o.orderNumber}/slot`).set(bearer(c.token)).send({ deliverySlot: open[1].start }).expect(403);
    expect(limit.body.reason).toBe('CHANGE_LIMIT');
    // staff are not limited, and the customer hears about staff changes
    await api().put(`/api/v1/admin/orders/${o.orderNumber}/slot`).set(bearer(s.ops)).send({ deliverySlot: open[1].start, reason: 'Customer called' }).expect(200);

    // guest order: changes with the order link only
    const g = await customer('Guest Like');
    const go = await order(g, [{ variant: s.bowl, quantity: 1 }]);
    const token = app.get(OrderAccessService).sign(go.id);
    await api().put(`/api/v1/orders/guest/${go.orderNumber}/address`).send({ address: { recipientName: 'Guest Like', phone: phone(), city: 'Doha', zone: '66', street: '901', building: '12' } }).expect(401);
    await api().put(`/api/v1/orders/guest/${go.orderNumber}/address`).set('x-order-token', token).send({ address: { recipientName: 'Guest Like', phone: phone(), city: 'Doha', zone: '66', street: '901', building: '12' } }).expect(200);
    expect(((await prisma.order.findUniqueOrThrow({ where: { id: go.id } })).shippingAddress as { zone: string }).zone).toBe('66');

    // packed and ready: the customer can no longer change it
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${go.so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    const closed = await api().put(`/api/v1/orders/guest/${go.orderNumber}/slot`).set('x-order-token', token).send({ deliverySlot: open[0].start }).expect(409);
    expect(closed.body.reason).toBe('NOT_EDITABLE');
    view = (await api().get(`/api/v1/orders/${go.orderNumber}`).set(bearer(g.token)).expect(200)).body;
    expect(view.changeOptions.canChange).toBe(false);
  });

  it('phone order: a new caller by phone, priced like the website, cash on delivery, marked with who took it', async () => {
    const caller = phone();
    const body = {
      customer: { fullName: 'Phone Caller', phone: caller },
      items: [{ variantId: s.mug, quantity: 2 }],
      address: { recipientName: 'Phone Caller', phone: caller, city: 'Doha', zone: '61', street: '840', building: '3' },
      note: 'Ring twice',
    };
    await api().post('/api/v1/admin/phone-orders').set(bearer(s.finance)).send(body).expect(403); // no orders.create
    const q = await api().post('/api/v1/admin/phone-orders/quote').set(bearer(s.ops)).send(body).expect(200);
    expect(q.body.customer.isNew).toBe(true);
    expect(q.body.cart.totals.subtotalMinor).toBe('8000');
    expect(await prisma.user.count({ where: { phone: caller } })).toBe(0); // a price check creates nothing
    const key = `p22-phone-${run}`;
    const placed = await api().post('/api/v1/admin/phone-orders').set(bearer(s.ops)).set('Idempotency-Key', key).send(body).expect(201);
    expect(placed.body).toMatchObject({ status: 'CONFIRMED', customer: { fullName: 'Phone Caller', isNew: true } });
    const again = await api().post('/api/v1/admin/phone-orders').set(bearer(s.ops)).set('Idempotency-Key', key).send(body).expect(201);
    expect(again.body.orderNumber).toBe(placed.body.orderNumber);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: placed.body.orderNumber }, include: { payments: true, user: true } });
    expect(o.placedById).toBe(await idOf('ops@demo.jovia.test'));
    expect(o.payments[0].method).toBe('COD');
    expect(o.user).toMatchObject({ phone: caller, isGuest: true, fullName: 'Phone Caller' });
    expect(await prisma.cart.count({ where: { guestToken: { startsWith: 'phone_' }, items: { some: {} } } })).toBe(0); // no leftover carts
    const detail = (await api().get(`/api/v1/admin/orders/${o.orderNumber}`).set(bearer(s.ops)).expect(200)).body;
    expect(detail.placedBy).toMatchObject({ name: 'Demo Operations' });
    // the same caller again is found by phone, not created twice
    const found = (await api().get('/api/v1/admin/phone-orders/customers').query({ q: caller.slice(-7) }).set(bearer(s.ops)).expect(200)).body;
    expect(found.map((u: { id: string }) => u.id)).toEqual([o.userId]);
    const second = await api().post('/api/v1/admin/phone-orders').set(bearer(s.ops)).send({ ...body, customer: { phone: caller } }).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: second.body.orderNumber } })).userId).toBe(o.userId);
    // staff accounts are never a phone-order customer
    await api().post('/api/v1/admin/phone-orders').set(bearer(s.ops)).send({ ...body, customer: { userId: s.adminId } }).expect(403);
    // products search for the order
    const products = (await api().get('/api/v1/admin/phone-orders/products').query({ q: `Change Mug ${run}` }).set(bearer(s.ops)).expect(200)).body;
    expect(products[0]).toMatchObject({ variantId: s.mug, priceMinor: '4000' });
  });

  it('door: the customer keeps part of the order — cash goes down, the rest is delivered, the units are booked back in', async () => {
    const c = await customer('Door Refuser');
    const o = await order(c, [{ variant: s.mug, quantity: 2 }, { variant: s.bowl, quantity: 1 }]);
    const [bowl, mug] = o.items;
    const job = await onTheRoad(o);
    const stockBefore = (await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.mug } })).onHand;
    await api().post(`/api/v1/courier/jobs/${job}/refuse-items`).set(bearer(s.courier)).send({ items: [{ itemId: mug.id, quantity: 2 }, { itemId: bowl.id, quantity: 1 }], reason: 'Changed mind' }).expect(400); // all = refuse the delivery instead
    await api().post(`/api/v1/courier/jobs/${job}/refuse-items`).set(bearer(s.courier)).send({ items: [{ itemId: mug.id, quantity: 3 }], reason: 'Changed mind' }).expect(400);
    await api().post(`/api/v1/courier/jobs/${job}/refuse-items`).set(bearer(s.admin)).send({ items: [{ itemId: mug.id, quantity: 1 }], reason: 'Changed mind' }).expect(403);
    const r = await api().post(`/api/v1/courier/jobs/${job}/refuse-items`).set(bearer(s.courier)).send({ items: [{ itemId: mug.id, quantity: 1 }], reason: 'Wrong colour' }).expect(200);
    expect(r.body.amountMinor).toBe('4000');
    const runNow = (await api().get('/api/v1/courier/jobs/run').set(bearer(s.courier)).expect(200)).body;
    const myJob = runNow.jobs.find((j: { id: string }) => j.id === job);
    expect(myJob.cash.amountMinor).toBe('6500'); // 1 mug + 1 bowl
    const code = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body.sellerOrders[0].delivery.deliveryCode;
    await api().post(`/api/v1/courier/jobs/${job}/deliver`).set(bearer(s.courier)).send({ code }).expect(200);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true, changes: true } });
    expect(after.status).toBe('DELIVERED');
    expect(after.payments[0]).toMatchObject({ status: 'CAPTURED', amountMinor: 6500n });
    expect((await prisma.codCollection.findUniqueOrThrow({ where: { sellerOrderId: o.so } })).amountMinor).toBe(6500n);
    expect(after.changes[0]).toMatchObject({ kind: 'DOOR_REFUSAL', byRole: 'DRIVER', amountMinor: 4000n });
    // the refused mug is on its way back: not on the shelf until booked in
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.mug } })).onHand).toBe(stockBefore);
    const open = (await api().get('/api/v1/admin/door-returns').set(bearer(s.ops)).expect(200)).body;
    const dr = open.find((x: { orderItem: { order: { orderNumber: string } } }) => x.orderItem.order.orderNumber === o.orderNumber);
    expect(dr).toMatchObject({ quantity: 1, reason: 'Wrong colour', driver: 'Khalid Courier' });
    await api().post(`/api/v1/admin/door-returns/${dr.id}/receive`).set(bearer(s.ops)).send({ condition: 'DAMAGED' }).expect(400); // needs a note
    await api().post(`/api/v1/admin/door-returns/${dr.id}/receive`).set(bearer(s.ops)).send({ condition: 'SELLABLE' }).expect(200);
    await api().post(`/api/v1/admin/door-returns/${dr.id}/receive`).set(bearer(s.ops)).send({ condition: 'SELLABLE' }).expect(409);
    expect((await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.mug } })).onHand).toBe(stockBefore + 1);
    s.doorOrder = o.orderNumber;
    s.doorCustomer = c.token;
    s.doorItem = mug.id;
  });

  it('return pickup: arranged for an approved return, done by the driver, the customer sees it, then checked as usual', async () => {
    const ret = await api().post(`/api/v1/orders/${s.doorOrder}/returns`).set(bearer(s.doorCustomer)).send({ orderItemId: s.doorItem, quantity: 1, reason: 'Does not fit' }).expect(201);
    const id = ret.body.id;
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    await api().post(`/api/v1/admin/returns/${id}/pickup`).set(bearer(s.ops)).send({ courierUserId: s.courierId, date: today }).expect(409); // not approved yet
    await api().post(`/api/v1/admin/returns/${id}/decision`).set(bearer(s.ops)).send({ decision: 'APPROVED' }).expect(200);
    await api().post(`/api/v1/admin/returns/${id}/pickup`).set(bearer(s.ops)).send({ courierUserId: s.adminId, date: today }).expect(400); // not a driver
    await api().post(`/api/v1/admin/returns/${id}/pickup`).set(bearer(s.ops)).send({ courierUserId: s.courierId, date: '2020-01-01' }).expect(400);
    const p = await api().post(`/api/v1/admin/returns/${id}/pickup`).set(bearer(s.ops)).send({ courierUserId: s.courierId, date: today, note: 'Call first' }).expect(201);
    await api().post(`/api/v1/admin/returns/${id}/pickup`).set(bearer(s.ops)).send({ courierUserId: s.courierId, date: today }).expect(409); // one at a time
    const mine = (await api().get('/api/v1/me/returns').set(bearer(s.doorCustomer)).expect(200)).body.find((x: { id: string }) => x.id === id);
    expect(mine.pickup).toMatchObject({ status: 'ASSIGNED' });
    const list = (await api().get('/api/v1/courier/pickups').set(bearer(s.courier)).expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === p.body.id)).toMatchObject({ orderNumber: s.doorOrder, note: 'Call first', item: { quantity: 1 } });
    // first visit fails, it is arranged again, then collected
    await api().post(`/api/v1/courier/pickups/${p.body.id}/failed`).set(bearer(s.courier)).send({ reason: 'Customer not at home' }).expect(200);
    await api().post(`/api/v1/courier/pickups/${p.body.id}/collected`).set(bearer(s.courier)).send({}).expect(409);
    await api().post(`/api/v1/admin/returns/${id}/pickup`).set(bearer(s.ops)).send({ courierUserId: s.courierId, date: today }).expect(201);
    await api().post(`/api/v1/courier/pickups/${p.body.id}/collected`).set(bearer(s.courier)).send({ lat: 25.3, lng: 51.5 }).expect(200);
    const admin = (await api().get('/api/v1/admin/returns').query({ status: 'APPROVED' }).set(bearer(s.ops)).expect(200)).body.items.find((x: { id: string }) => x.id === id);
    expect(admin.pickup).toMatchObject({ status: 'COLLECTED', driver: 'Khalid Courier' });
    // then the warehouse checks it the normal way
    await api().post(`/api/v1/admin/returns/${id}/received`).set(bearer(s.ops)).send({ condition: 'SELLABLE' }).expect(200);
    expect(await prisma.notification.count({ where: { type: 'RETURN_PICKUP_SCHEDULED', data: { path: ['orderNumber'], equals: s.doorOrder } } })).toBeGreaterThan(0);
  });
});
