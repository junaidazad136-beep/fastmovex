/**
 * PHASE 18 on a real database: the customer's delivery code (customers see it, staff never do), staff cannot close a
 * driver delivery without it unless a manager writes a reason, cash on delivery is recorded per holder and handed to a
 * cashier with a count (shortages stay on record, rows cannot be edited), drivers over the cash limit cannot pick up,
 * refunds need a second person, fake-COD rules (amount, open orders, block, refusals) and returns inspected on arrival.
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
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9746${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

describe('Cash and fraud controls — real database', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const sent: { to: string; body: string }[] = [];
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;

  async function customer(name = 'Noora Test') {
    const email = `cash.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: name, email, password: 'Buyer-Pass-123' }).expect(201);
    const p = phone();
    const addr = await api().post('/api/v1/addresses').set(bearer(reg.body.accessToken)).send({ recipientName: name, phone: p, countryCode: 'QA', city: 'Doha', zone: '31', street: '230', building: '7', isDefault: true }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    return { token: reg.body.accessToken as string, address: addr.body.id as string, phone: p, id: user.id };
  }
  async function cod(c: { token: string; address: string }, quantity = 1, variant = s.variant) {
    await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: variant, quantity }).expect(201);
    return api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `cash-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: c.address, paymentMethod: 'COD' });
  }
  /** Ready for a FastMoveX driver and given to the demo courier. */
  async function dispatch(orderNumber: string, assign = true) {
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { sellerOrders: true } });
    const so = o.sellerOrders[0].id;
    for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    let d = null;
    for (let i = 0; i < 50 && !d; i++) { d = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: so } }); if (!d) await new Promise((r) => setTimeout(r, 100)); }
    if (assign) await api().post(`/api/v1/admin/deliveries/${d!.id}/assign`).set(bearer(s.admin)).send({ courierUserId: s.courierId }).expect(200);
    return { so, delivery: d!.id, code: d!.deliveryCode!, total: o.totalMinor };
  }
  const onTheWay = async (id: string) => {
    await api().post(`/api/v1/courier/jobs/${id}/pickup`).set(bearer(s.courier)).expect(200);
    await api().post(`/api/v1/courier/jobs/${id}/out-for-delivery`).set(bearer(s.courier)).expect(200);
  };
  /** A manager closes a driver delivery without the code (collected at the counter). */
  async function closeByManager(so: string) {
    await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status: 'SHIPPED' }).expect(200);
    await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status: 'DELIVERED', overrideReason: 'Collected at the warehouse counter' }).expect(200);
  }
  /** Finance receives everything the courier holds (so a test starts from zero). */
  async function clearCourierCash() {
    const h = (await api().get(`/api/v1/admin/cash/holders/${s.courierId}`).set(bearer(s.finance)).expect(200)).body;
    if (!h.open.length) return;
    await api().post(`/api/v1/admin/cash/holders/${s.courierId}/handover`).set(bearer(s.finance)).send({ collectionIds: h.open.map((o: { id: string }) => o.id), receivedMinor: h.inHandMinor }).expect(201);
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 2, driverCashLimitMinor: null });
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockImplementation(async (_c, to, _t, body) => { sent.push({ to, body }); });
    s.admin = await login('admin@demo.jovia.test');
    s.ops = await login('ops@demo.jovia.test');
    s.finance = await login('finance@demo.jovia.test');
    s.finance2 = await login('finance2@demo.jovia.test');
    s.courier = await login('courier@demo.jovia.test');
    s.courierId = (await prisma.user.findFirstOrThrow({ where: { email: 'courier@demo.jovia.test' } })).id;
    s.adminId = (await prisma.user.findFirstOrThrow({ where: { email: 'admin@demo.jovia.test' } })).id;
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title: `Cash Teapot ${run}`, categoryId: cat.id, variants: [{ sku: `CASH-${run}`, priceMinor: '6000', initialStock: 200 }] }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
  });

  afterAll(async () => {
    await restoreCod?.();
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('the customer sees the delivery code (and gets it by SMS); staff and the shipment page never do', async () => {
    const c = await customer();
    const o = await cod(c);
    expect(o.status).toBe(201);
    const d = await dispatch(o.body.orderNumber);
    s.d1 = d.delivery; s.so1 = d.so; s.code1 = d.code;
    await onTheWay(d.delivery);

    const mine = (await api().get(`/api/v1/orders/${o.body.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(mine.sellerOrders[0].delivery).toMatchObject({ method: 'JOVIA', status: 'OUT_FOR_DELIVERY', deliveryCode: d.code, courierName: 'Khalid' });

    const staff = (await api().get(`/api/v1/admin/orders/${o.body.orderNumber}`).set(bearer(s.admin)).expect(200)).body;
    expect(JSON.stringify(staff)).not.toContain('"deliveryCode"');
    expect(staff.sellerOrders[0].delivery.hasCode).toBe(true);
    const list = (await api().get('/api/v1/admin/deliveries').set(bearer(s.admin)).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain('"deliveryCode"');

    let sms;
    for (let i = 0; i < 40 && !sms; i++) { sms = sent.find((m) => m.to === c.phone && m.body.includes(d.code)); if (!sms) await new Promise((r) => setTimeout(r, 150)); }
    expect(sms?.body).toContain(`Delivery code: ${d.code}`);
  });

  it('staff need the code to close a driver delivery; only a manager can skip it, with a reason that is recorded', async () => {
    // operations staff without the override permission
    const ops = await api().post(`/api/v1/admin/orders/shipments/${s.so1}/status`).set(bearer(s.ops)).send({ status: 'DELIVERED' });
    expect(ops.status).toBe(403);
    expect(ops.body.reason).toBe('DELIVERY_CODE_REQUIRED');
    const wrong = s.code1 === '0000' ? '1111' : '0000';
    await api().post(`/api/v1/admin/orders/shipments/${s.so1}/status`).set(bearer(s.ops)).send({ status: 'DELIVERED', code: wrong }).expect(400);
    expect((await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: s.d1 } })).attempts).toBe(1);
    // a manager without a reason
    const noReason = await api().post(`/api/v1/admin/orders/shipments/${s.so1}/status`).set(bearer(s.admin)).send({ status: 'DELIVERED' });
    expect(noReason.body.reason).toBe('OVERRIDE_REASON_REQUIRED');
    // with the right code it closes; the cash is now on the courier's name
    await api().post(`/api/v1/admin/orders/shipments/${s.so1}/status`).set(bearer(s.ops)).send({ status: 'DELIVERED', code: s.code1 }).expect(200);
    const cash = await prisma.codCollection.findUniqueOrThrow({ where: { sellerOrderId: s.so1 } });
    expect(cash).toMatchObject({ holderUserId: s.courierId, handoverId: null });

    // override: a second order, never assigned, closed by the manager — the manager now holds that cash
    const c = await customer();
    const o = await cod(c);
    const d = await dispatch(o.body.orderNumber, false);
    await api().post(`/api/v1/admin/orders/shipments/${d.so}/status`).set(bearer(s.admin)).send({ status: 'SHIPPED' }).expect(200);
    await api().post(`/api/v1/admin/orders/shipments/${d.so}/status`).set(bearer(s.admin)).send({ status: 'DELIVERED', overrideReason: 'Customer collected at the warehouse counter' }).expect(200);
    const rec = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: d.delivery } });
    expect(rec).toMatchObject({ status: 'DELIVERED', overrideById: s.adminId, overrideReason: 'Customer collected at the warehouse counter' });
    expect(await prisma.auditLog.count({ where: { action: 'delivery.override', entityId: d.delivery } })).toBe(1);
    expect((await prisma.codCollection.findUniqueOrThrow({ where: { sellerOrderId: d.so } })).holderUserId).toBe(s.adminId);
    s.adminCashSo = d.so;
  });

  it('cash is handed to a cashier with a count: nobody receives their own, shortages need a note, nothing is counted twice', async () => {
    // the admin holds cash from the override: they cannot receive it themselves
    const own = (await api().get(`/api/v1/admin/cash/holders/${s.adminId}`).set(bearer(s.admin)).expect(200)).body;
    const adminIds = own.open.map((o: { id: string }) => o.id);
    await api().post(`/api/v1/admin/cash/holders/${s.adminId}/handover`).set(bearer(s.admin)).send({ collectionIds: adminIds, receivedMinor: own.inHandMinor }).expect(403);
    await api().post(`/api/v1/admin/cash/holders/${s.adminId}/handover`).set(bearer(s.finance)).send({ collectionIds: adminIds, receivedMinor: own.inHandMinor }).expect(201);
    // operations may look but not receive
    const holders = (await api().get('/api/v1/admin/cash/holders').set(bearer(s.ops)).expect(200)).body;
    const courierRow = holders.holders.find((h: { user: { id: string } }) => h.user.id === s.courierId);
    expect(courierRow.user.isDriver).toBe(true);
    const h = (await api().get(`/api/v1/admin/cash/holders/${s.courierId}`).set(bearer(s.ops)).expect(200)).body;
    const ids = h.open.map((o: { id: string }) => o.id);
    const expected = BigInt(h.inHandMinor);
    await api().post(`/api/v1/admin/cash/holders/${s.courierId}/handover`).set(bearer(s.ops)).send({ collectionIds: ids, receivedMinor: h.inHandMinor }).expect(403);

    const short = await api().post(`/api/v1/admin/cash/holders/${s.courierId}/handover`).set(bearer(s.finance)).send({ collectionIds: ids, receivedMinor: String(expected - 500n) });
    expect(short.status).toBe(400);
    expect(short.body.reason).toBe('NOTE_REQUIRED');
    const ok = await api().post(`/api/v1/admin/cash/holders/${s.courierId}/handover`).set(bearer(s.finance))
      .send({ collectionIds: ids, receivedMinor: String(expected - 500n), note: 'Five riyals short, driver will pay tomorrow' }).expect(201);
    expect(ok.body).toMatchObject({ expectedMinor: expected.toString(), receivedMinor: String(expected - 500n), varianceMinor: '-500', orders: ids.length, holder: { id: s.courierId } });
    expect(ok.body.number).toMatch(/^CH-QA-\d{6}-[0-9A-F]{6}$/);
    s.handover = ok.body.id;
    await api().post(`/api/v1/admin/cash/holders/${s.courierId}/handover`).set(bearer(s.finance2)).send({ collectionIds: ids, receivedMinor: h.inHandMinor }).expect(409);
    expect(await prisma.auditLog.count({ where: { action: 'cash.handover_short', entityId: s.handover } })).toBe(1);

    // the records cannot be edited or deleted, even straight in the database
    await expect(prisma.cashHandover.update({ where: { id: s.handover }, data: { receivedMinor: expected } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.codCollection.updateMany({ where: { id: ids[0] }, data: { handoverId: null } })).rejects.toThrow(/already handed over/);
    await expect(prisma.codCollection.deleteMany({ where: { id: ids[0] } })).rejects.toThrow(/cannot be deleted/);

    // receipts: staff and the driver (own only)
    const pdf = await api().get(`/api/v1/admin/cash/handovers/${s.handover}/receipt`).set(bearer(s.finance)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await api().get(`/api/v1/courier/cash/handovers/${s.handover}/receipt`).set(bearer(s.courier)).expect(200);
    const mine = (await api().get('/api/v1/courier/cash').set(bearer(s.courier)).expect(200)).body;
    expect(mine.inHandMinor).toBe('0');
    expect(mine.handovers[0]).toMatchObject({ id: s.handover, varianceMinor: '-500' });
    const shortList = (await api().get('/api/v1/admin/cash/handovers').query({ shortOnly: true }).set(bearer(s.finance)).expect(200)).body;
    expect(shortList.some((x: { id: string }) => x.id === s.handover)).toBe(true);
  });

  it('a driver holding the cash limit hands it over before picking up more; the run sheet prints', async () => {
    await clearCourierCash();
    const c = await customer();
    const first = await cod(c);
    const d1 = await dispatch(first.body.orderNumber);
    await onTheWay(d1.delivery);
    await api().post(`/api/v1/courier/jobs/${d1.delivery}/deliver`).set(bearer(s.courier)).field('code', d1.code).expect(200);
    const held = (await api().get('/api/v1/courier/cash').set(bearer(s.courier)).expect(200)).body;
    expect(BigInt(held.inHandMinor)).toBe(d1.total);

    await setCodRules(prisma, { driverCashLimitMinor: held.inHandMinor });
    const second = await cod(c);
    const d2 = await dispatch(second.body.orderNumber);
    const blocked = await api().post(`/api/v1/courier/jobs/${d2.delivery}/pickup`).set(bearer(s.courier));
    expect(blocked.status).toBe(403);
    expect(blocked.body.reason).toBe('CASH_LIMIT');
    expect((await api().get('/api/v1/courier/cash').set(bearer(s.courier)).expect(200)).body.limitMinor).toBe(held.inHandMinor);

    const sheet = await api().get('/api/v1/courier/jobs/run.pdf').set(bearer(s.courier)).expect(200);
    expect(sheet.headers['content-type']).toBe('application/pdf');
    await api().get('/api/v1/admin/deliveries/run-sheet.pdf').query({ courierUserId: s.courierId }).set(bearer(s.ops)).expect(200);
    await api().get('/api/v1/admin/deliveries/run-sheet.pdf').query({ courierUserId: s.adminId }).set(bearer(s.ops)).expect(404); // not a driver

    await clearCourierCash();
    await api().post(`/api/v1/courier/jobs/${d2.delivery}/pickup`).set(bearer(s.courier)).expect(200);
    await setCodRules(prisma, { driverCashLimitMinor: null });
  });

  it('refunds need a second person (four-eyes)', async () => {
    const c = await customer();
    const o = await cod(c);
    const d = await dispatch(o.body.orderNumber, false);
    await closeByManager(d.so);
    const r = await api().post('/api/v1/admin/refunds').set(bearer(s.admin)).send({ orderNumber: o.body.orderNumber, sellerOrderId: d.so, amountMinor: '1000', reason: 'Goodwill for a dented box' }).expect(201);
    const self = await api().post(`/api/v1/admin/refunds/${r.body.id}/approve`).set(bearer(s.admin));
    expect(self.status).toBe(403);
    expect(self.body.reason).toBe('FOUR_EYES');
    await api().post(`/api/v1/admin/refunds/${r.body.id}/approve`).set(bearer(s.finance)).expect(200);
    const list = (await api().get('/api/v1/admin/refunds').set(bearer(s.finance)).expect(200)).body;
    const row = list.items.find((x: { id: string }) => x.id === r.body.id);
    expect(row).toMatchObject({ createdBy: { id: s.adminId }, approvedBy: { fullName: 'Demo Finance' } });
    s.refundOrder = o.body.orderNumber; s.refundCustomer = c.token;
  });

  it('fake COD rules: order size, open orders, blocked customers and phones, refusals at the door', async () => {
    const c = await customer();
    const restore = await setCodRules(prisma, { maxOrderMinor: '10000', maxOpenOrders: 2 });
    const big = await cod(c, 2); // 2 x 60 QAR + delivery > 100 QAR
    expect(big.status).toBe(400);
    expect(big.body.reason).toBe('COD_LIMIT');
    await api().delete('/api/v1/cart').set(bearer(c.token)).expect((res) => expect([200, 204]).toContain(res.status));
    expect((await cod(c)).status).toBe(201);
    expect((await cod(c)).status).toBe(201);
    const third = await cod(c);
    expect(third.body.reason).toBe('COD_OPEN_ORDERS');
    // card is still fine
    await api().delete('/api/v1/cart').set(bearer(c.token));
    await restore();

    // staff switch COD off for a customer — a reason is required, and the same phone on another account is blocked too
    await api().post(`/api/v1/admin/users/${c.id}/cod`).set(bearer(s.admin)).send({ blocked: true }).expect(400);
    await api().post(`/api/v1/admin/users/${c.id}/cod`).set(bearer(s.ops)).send({ blocked: true, reason: 'Fake orders' }).expect(403); // users.update
    await prisma.user.update({ where: { id: c.id }, data: { phone: c.phone } });
    await api().post(`/api/v1/admin/users/${c.id}/cod`).set(bearer(s.admin)).send({ blocked: true, reason: 'Three fake orders last week' }).expect(200);
    expect((await cod(c)).body.reason).toBe('COD_BLOCKED');
    const other = await customer();
    await prisma.address.update({ where: { id: other.address }, data: { phone: c.phone } });
    expect((await cod(other)).body.reason).toBe('COD_BLOCKED');
    const detail = (await api().get(`/api/v1/admin/users/${c.id}`).set(bearer(s.admin)).expect(200)).body;
    expect(detail).toMatchObject({ codBlocked: true, codBlockedReason: 'Three fake orders last week' });
    await api().post(`/api/v1/admin/users/${c.id}/cod`).set(bearer(s.admin)).send({ blocked: false }).expect(200);
    await api().delete('/api/v1/cart').set(bearer(c.token));
    await api().delete('/api/v1/cart').set(bearer(other.token));

    // refusals: two refused COD orders switch COD off automatically (the same delivery refused twice counts once)
    const r = await customer();
    for (let i = 0; i < 2; i++) {
      const o = await cod(r);
      const d = await dispatch(o.body.orderNumber);
      await onTheWay(d.delivery);
      await api().post(`/api/v1/courier/jobs/${d.delivery}/fail`).set(bearer(s.courier)).send({ reason: 'Said he did not order it', refused: true }).expect(200);
      if (i === 0) {
        await api().post(`/api/v1/courier/jobs/${d.delivery}/out-for-delivery`).set(bearer(s.courier)).expect(200);
        await api().post(`/api/v1/courier/jobs/${d.delivery}/fail`).set(bearer(s.courier)).send({ reason: 'Refused again', refused: true }).expect(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: r.id } })).codRefusals).toBe(1);
      }
    }
    const blocked = await prisma.user.findUniqueOrThrow({ where: { id: r.id } });
    expect(blocked).toMatchObject({ codRefusals: 2, codBlocked: true, codBlockedReason: 'Refused 2 cash-on-delivery orders at the door' });
    expect((await cod(r)).body.reason).toBe('COD_BLOCKED');
    await api().delete('/api/v1/cart').set(bearer(r.token));
  });

  it('returns are inspected: sellable goes back on the shelf, damaged is refunded but kept off stock, not accepted gets no refund', async () => {
    const c = await customer();
    const o = await cod(c, 3);
    expect(o.status).toBe(201);
    const d = await dispatch(o.body.orderNumber, false);
    await closeByManager(d.so);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { sellerOrderId: d.so } });
    const stock = async () => (await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } })).onHand;
    const ret = async () => {
      const r = await api().post(`/api/v1/orders/${o.body.orderNumber}/returns`).set(bearer(c.token)).send({ orderItemId: item.id, quantity: 1, reason: 'Not as expected' }).expect(201);
      await api().post(`/api/v1/admin/returns/${r.body.id}/decision`).set(bearer(s.admin)).send({ decision: 'APPROVED' }).expect(200);
      return r.body.id as string;
    };

    const a = await ret();
    await api().post(`/api/v1/admin/returns/${a}/received`).set(bearer(s.admin)).send({}).expect(400); // condition required
    await api().post(`/api/v1/admin/returns/${a}/received`).set(bearer(s.admin)).send({ condition: 'DAMAGED' }).expect(400); // note required
    let before = await stock();
    await api().post(`/api/v1/admin/returns/${a}/received`).set(bearer(s.admin)).send({ condition: 'DAMAGED', note: 'Lid cracked' }).expect(200);
    expect(await stock()).toBe(before);
    expect(await prisma.returnRequest.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ status: 'RECEIVED', condition: 'DAMAGED', inspectionNote: 'Lid cracked' });
    expect(await prisma.refund.count({ where: { idempotencyKey: `return_${a}` } })).toBe(1);

    const b = await ret();
    before = await stock();
    await api().post(`/api/v1/admin/returns/${b}/received`).set(bearer(s.admin)).send({ condition: 'SELLABLE' }).expect(200);
    expect(await stock()).toBe(before + 1);

    const n = await ret();
    before = await stock();
    await api().post(`/api/v1/admin/returns/${n}/received`).set(bearer(s.admin)).send({ condition: 'NOT_ACCEPTED', note: 'Different teapot sent back' }).expect(200);
    expect(await stock()).toBe(before);
    expect(await prisma.returnRequest.findUniqueOrThrow({ where: { id: n } })).toMatchObject({ status: 'REJECTED', condition: 'NOT_ACCEPTED' });
    expect(await prisma.refund.count({ where: { idempotencyKey: `return_${n}` } })).toBe(0);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).status).not.toBe('RETURN_REQUESTED');
  });
});
