/**
 * PHASE 20 on a real database: the customer's invoice (own orders only, guests with their link), credit notes
 * numbered by the database when a refund is paid, return receipts, packing slips and picking lists for the warehouse,
 * and the customer's data rights — download everything, delete the account after a waiting period.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { PrivacyService } from '../../src/account/privacy';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9746${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); };
const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-';

describe('Phase 20 — documents and privacy (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;
  const pdf = (path: string, headers: Record<string, string>) => api().get(path).set(headers).buffer(true).parse(binary);

  async function customer(name = 'Hessa Docs') {
    const email = `p20.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: name, email, password: 'Buyer-Pass-123' }).expect(201);
    const addr = await api().post('/api/v1/addresses').set(bearer(reg.body.accessToken)).send({ recipientName: name, phone: phone(), countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '3', unit: 'Flat 9', isDefault: true }).expect(201);
    const id = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    return { token: reg.body.accessToken as string, address: addr.body.id as string, email, password: 'Buyer-Pass-123', id };
  }
  async function order(c: { token: string; address: string }, paymentMethod: 'COD' | 'CARD' = 'COD', variant = s.variant, quantity = 1) {
    await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: variant, quantity }).expect(201);
    const r = await api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `p20-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: c.address, paymentMethod }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: r.body.orderNumber }, include: { sellerOrders: { include: { items: true } } } });
    return { orderNumber: o.orderNumber, so: o.sellerOrders[0].id, item: o.sellerOrders[0].items[0].id };
  }
  async function deliver(so: string) {
    for (const status of ['PREPARING', 'READY_FOR_PICKUP', 'SHIPPED']) await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
    await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status: 'DELIVERED', overrideReason: 'Collected at the warehouse counter' }).expect(200);
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 5, driverCashLimitMinor: null });
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined as never);
    s.admin = await login('admin@demo.jovia.test');
    s.ops = await login('ops@demo.jovia.test');
    s.finance = await login('finance@demo.jovia.test');
    s.finance2 = await login('finance2@demo.jovia.test');
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title: `Docs Kettle ${run}`, titleAr: `غلاية ${run}`, categoryId: cat.id, variants: [{ sku: `DOC-${run}`, barcode: `629${run}`, priceMinor: '9000', initialStock: 200 }] }).expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
    await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
    s.variant = p.body.variants[0].id;
    s.warehouse = ((await api().get('/api/v1/admin/warehouses').set(bearer(s.admin)).expect(200)).body.items as { id: string; isDefault: boolean }[]).find((w) => w.isDefault)!.id;
    await prisma.warehouseStock.update({ where: { warehouseId_variantId: { warehouseId: s.warehouse, variantId: s.variant } }, data: { bin: 'C-07' } });
  });

  afterAll(async () => {
    await restoreCod?.();
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  it('invoice: the customer gets their own (in Arabic too); another customer and a wrong guest link get nothing', async () => {
    const c = await customer();
    const o = await order(c);
    const mine = await pdf(`/api/v1/orders/${o.orderNumber}/invoice.pdf?lang=ar`, bearer(c.token)).expect(200);
    expect(mine.headers['content-type']).toContain('application/pdf');
    expect(isPdf(mine.body)).toBe(true);
    const other = await customer('Someone Else');
    await api().get(`/api/v1/orders/${o.orderNumber}/invoice.pdf`).set(bearer(other.token)).expect(404);
    await api().get(`/api/v1/orders/guest/${o.orderNumber}/invoice.pdf`).set('X-Order-Token', 'x'.repeat(40)).expect(404);
    const view = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(view.documents).toEqual({ invoice: true, creditNotes: [], returnReceipts: [] });
    expect(isPdf((await pdf(`/api/v1/admin/orders/${o.orderNumber}/invoice.pdf`, bearer(s.ops)).expect(200)).body)).toBe(true);
  });

  it('guest checkout: the invoice with the order link', async () => {
    const cart = (await api().post('/api/v1/cart/items').send({ variantId: s.variant, quantity: 1 }).expect(201)).body.cartToken as string;
    const p = phone();
    const r = await api().post('/api/v1/checkout/guest').set('x-cart-token', cart).set('Idempotency-Key', `p20g-${run}`).send({
      contact: { fullName: 'Guest Docs', email: `p20g.${run}@example.com`, phone: p },
      address: { recipientName: 'Guest Docs', phone: p, city: 'Doha', zone: '25', street: '230', building: '7' },
      paymentMethod: 'COD',
    }).expect(201);
    const res = await pdf(`/api/v1/orders/guest/${r.body.orderNumber}/invoice.pdf`, { 'X-Order-Token': r.body.orderAccessToken }).expect(200);
    expect(isPdf(res.body)).toBe(true);
    const view = (await api().get(`/api/v1/orders/guest/${r.body.orderNumber}`).set('X-Order-Token', r.body.orderAccessToken).expect(200)).body;
    expect(view.documents.invoice).toBe(true);
  });

  it('credit note: numbered by the database when the refund is paid, never renumbered, the customer can download it', async () => {
    const c = await customer();
    const o = await order(c, 'CARD');
    const created = (await api().post('/api/v1/admin/refunds').set(bearer(s.finance)).send({ orderNumber: o.orderNumber, sellerOrderId: o.so, amountMinor: '1500', reason: 'Late delivery goodwill' }).expect(201)).body;
    const refundId = created.id ?? (await prisma.refund.findFirstOrThrow({ where: { order: { orderNumber: o.orderNumber } } })).id;
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundId } })).creditNoteNo).toBeNull();
    await api().get(`/api/v1/orders/${o.orderNumber}/credit-notes/${refundId}.pdf`).set(bearer(c.token)).expect(409); // not paid yet
    await api().post(`/api/v1/admin/refunds/${refundId}/approve`).set(bearer(s.finance2)).expect(200);
    const paid = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    expect(paid.status).toBe('SUCCEEDED');
    expect(paid.creditNoteNo).toMatch(/^CN-QA-\d{6}-\d{6}$/);
    await expect(prisma.refund.update({ where: { id: refundId }, data: { creditNoteNo: 'CN-FAKE' } })).rejects.toThrow();
    const view = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(view.documents.creditNotes).toEqual([expect.objectContaining({ id: refundId, number: paid.creditNoteNo, amountMinor: '1500' })]);
    expect(isPdf((await pdf(`/api/v1/orders/${o.orderNumber}/credit-notes/${refundId}.pdf`, bearer(c.token)).expect(200)).body)).toBe(true);
    const other = await customer('Not Mine');
    await api().get(`/api/v1/orders/${o.orderNumber}/credit-notes/${refundId}.pdf`).set(bearer(other.token)).expect(404);
    expect(isPdf((await pdf(`/api/v1/admin/refunds/${refundId}/credit-note.pdf`, bearer(s.finance)).expect(200)).body)).toBe(true);
    await api().get(`/api/v1/admin/refunds/${refundId}/credit-note.pdf`).set(bearer(s.ops)).expect(403); // payments.read
  });

  it('return receipt once the item is back and checked', async () => {
    const c = await customer();
    const o = await order(c);
    await deliver(o.so);
    const ret = (await api().post(`/api/v1/orders/${o.orderNumber}/returns`).set(bearer(c.token)).send({ orderItemId: o.item, quantity: 1, reason: 'Lid does not close' }).expect(201)).body;
    await api().post(`/api/v1/admin/returns/${ret.id}/decision`).set(bearer(s.admin)).send({ decision: 'APPROVED' }).expect(200);
    await api().get(`/api/v1/orders/${o.orderNumber}/return-receipts/${ret.id}.pdf`).set(bearer(c.token)).expect(409); // not back yet
    await api().post(`/api/v1/admin/returns/${ret.id}/received`).set(bearer(s.admin)).send({ condition: 'DAMAGED', note: 'Lid hinge broken' }).expect(200);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: ret.id } })).receivedAt).toBeInstanceOf(Date);
    const view = (await api().get(`/api/v1/orders/${o.orderNumber}`).set(bearer(c.token)).expect(200)).body;
    expect(view.documents.returnReceipts).toEqual([expect.objectContaining({ id: ret.id, condition: 'DAMAGED', number: expect.stringMatching(/^RR-[0-9A-F]{10}$/) })]);
    expect(isPdf((await pdf(`/api/v1/orders/${o.orderNumber}/return-receipts/${ret.id}.pdf`, bearer(c.token)).expect(200)).body)).toBe(true);
    expect(isPdf((await pdf(`/api/v1/admin/returns/${ret.id}/receipt.pdf`, bearer(s.admin)).expect(200)).body)).toBe(true);
  });

  it('picking list adds up the same product across orders, in shelf order; packing slips per shipment; cancelled ones refused', async () => {
    const c1 = await customer();
    const c2 = await customer();
    const a = await order(c1, 'COD', s.variant, 2);
    const b = await order(c2, 'COD', s.variant, 3);
    const list = (await api().get(`/api/v1/admin/fulfilment/pick-list?ids=${a.so},${b.so}`).set(bearer(s.ops)).expect(200)).body;
    expect(list.shipments).toHaveLength(2);
    expect(list.lines).toEqual([expect.objectContaining({ variantId: s.variant, quantity: 5, bin: 'C-07', orders: expect.arrayContaining([{ orderNumber: a.orderNumber, quantity: 2 }, { orderNumber: b.orderNumber, quantity: 3 }]) })]);
    const all = (await api().get(`/api/v1/admin/fulfilment/pick-list?warehouseId=${s.warehouse}`).set(bearer(s.ops)).expect(200)).body;
    // the full list is the oldest 300 to pick; a long-lived test database may hold more than that
    if (all.shipments.length < 300) expect(all.shipments.some((x: { id: string }) => x.id === a.so)).toBe(true);
    else expect(all.shipments).toHaveLength(300);
    expect(isPdf((await pdf(`/api/v1/admin/fulfilment/pick-list.pdf?ids=${a.so},${b.so}`, bearer(s.ops)).expect(200)).body)).toBe(true);
    expect(isPdf((await pdf(`/api/v1/admin/fulfilment/packing-slips.pdf?ids=${a.so},${b.so}`, bearer(s.ops)).expect(200)).body)).toBe(true);
    expect(isPdf((await pdf(`/api/v1/admin/orders/shipments/${a.so}/packing-slip.pdf`, bearer(s.ops)).expect(200)).body)).toBe(true);
    await api().post(`/api/v1/orders/${b.orderNumber}/cancel`).set(bearer(c2.token)).send({ reason: 'Changed my mind' }).expect(200);
    expect((await api().get(`/api/v1/admin/orders/shipments/${b.so}/packing-slip.pdf`).set(bearer(s.ops)).expect(409)).body.reason).toBe('CANCELLED');
    const shopper = await customer();
    await api().get('/api/v1/admin/fulfilment/pick-list').set(bearer(shopper.token)).expect(403);
  });

  describe('my data and account deletion', () => {
    it('download my data: profile, addresses, orders; no internal notes, no password', async () => {
      const c = await customer('Data Owner');
      const o = await order(c);
      const res = await api().get('/api/v1/me/data-export').set(bearer(c.token)).expect(200);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="fastmovex-my-data-\d{4}-\d{2}-\d{2}\.json"/);
      const data = JSON.parse(res.text);
      expect(data.account).toMatchObject({ email: c.email, fullName: 'Data Owner' });
      expect(data.account.passwordHash).toBeUndefined();
      expect(data.addresses).toHaveLength(1);
      expect(data.orders[0]).toMatchObject({ orderNumber: o.orderNumber });
      expect(typeof data.orders[0].totalMinor).toBe('string');
      expect(await prisma.auditLog.count({ where: { action: 'privacy.data_exported', entityId: c.id } })).toBe(1);
      const admin = await api().get(`/api/v1/admin/users/${c.id}/data-export`).set(bearer(s.admin)).expect(200);
      expect(JSON.parse(admin.text).account.email).toBe(c.email);
    });

    it('cannot delete with an open order; wrong password refused; staff accounts refused', async () => {
      const c = await customer();
      await order(c);
      expect((await api().post('/api/v1/me/deletion').set(bearer(c.token)).send({ password: c.password }).expect(409)).body).toMatchObject({ reason: 'OPEN_ACTIVITY', blockers: [{ reason: 'OPEN_ORDERS', count: 1 }] });
      const c2 = await customer();
      expect((await api().post('/api/v1/me/deletion').set(bearer(c2.token)).send({ password: 'Wrong-Pass-999' }).expect(401)).body.reason).toBe('BAD_PASSWORD');
      expect((await api().post('/api/v1/me/deletion').set(bearer(s.ops)).send({ password: DEMO_PASSWORD }).expect(403)).body.reason).toBe('STAFF_ACCOUNT');
    });

    it('scheduled → signed out → signing in shows it → kept; asked again → deleted after the wait: personal details gone, order kept without them', async () => {
      const c = await customer('Leaving Customer');
      const o = await order(c);
      await deliver(o.so);
      const first = (await api().post('/api/v1/me/deletion').set(bearer(c.token)).send({ password: c.password, reason: 'Moving abroad' }).expect(200)).body;
      expect(new Date(first.deleteOn).getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
      expect(await prisma.refreshToken.count({ where: { userId: c.id, revokedAt: null } })).toBe(0);
      const t2 = await login(c.email, c.password);
      expect((await api().get('/api/v1/auth/me').set(bearer(t2)).expect(200)).body.deletion).toMatchObject({ deleteOn: first.deleteOn });
      await api().delete('/api/v1/me/deletion').set(bearer(t2)).expect(200);
      expect((await api().get('/api/v1/auth/me').set(bearer(t2)).expect(200)).body.deletion).toBeNull();
      await api().delete('/api/v1/me/deletion').set(bearer(t2)).expect(409);

      await api().post('/api/v1/me/deletion').set(bearer(t2)).send({ password: c.password }).expect(200);
      const svc = app.get(PrivacyService);
      expect((await svc.runDue(new Date())).deleted).toBe(0); // still waiting
      await svc.runDue(new Date(Date.now() + 15 * 86_400_000));
      const u = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
      expect(u).toMatchObject({ fullName: 'Deleted customer', email: null, phone: null, passwordHash: null, status: 'DELETED' });
      expect(u.deletedAt).toBeInstanceOf(Date);
      expect(await prisma.address.count({ where: { userId: c.id } })).toBe(0);
      const kept = await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber } });
      expect(kept.shippingAddress).toEqual({ recipientName: 'Deleted customer', countryCode: 'QA', city: 'Doha', zone: '61' });
      expect(kept.totalMinor).toBeGreaterThan(0n);
      await api().post('/api/v1/auth/login').send({ identifier: c.email, password: c.password }).expect(401);
      expect(await prisma.auditLog.count({ where: { action: 'privacy.account_deleted', entityId: c.id } })).toBe(1);
      // the invoice still prints for the accounts, without the person
      expect(isPdf((await pdf(`/api/v1/admin/orders/${o.orderNumber}/invoice.pdf`, bearer(s.admin)).expect(200)).body)).toBe(true);
    });
  });
});
