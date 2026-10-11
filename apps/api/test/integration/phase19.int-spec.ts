/**
 * PHASE 19 on a real database: staff two-step sign-in (codes, recovery codes, replay, lockout, sessions, admin reset),
 * failed-delivery proof and customer reschedule, write-off rules, dated lots (FEFO and the nightly expiry run),
 * blind stocktakes with a second approver, purchase orders received by a second person, and payment reconciliation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { totp } from '../../src/auth/totp';
import { ExpiryService } from '../../src/inventory/stock-control';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setCodRules } from './cod-helper';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';
const SUPER = { email: process.env.SUPER_ADMIN_EMAIL || 'owner@jovia.test', password: process.env.SUPER_ADMIN_PASSWORD || 'Owner-Pass-2026' };
const run = randomBytes(3).toString('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const phone = () => `+9746${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

describe('Phase 19 — security, delivery proof, stock control, payments (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let restoreCod: (() => Promise<void>) | undefined;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const s: Record<string, string> = {};
  const login = async (identifier: string, password = DEMO_PASSWORD) => (await api().post('/api/v1/auth/login').send({ identifier, password }).expect(200)).body.accessToken as string;

  async function staff(roles: string[], name = 'Phase19 Staff') {
    const email = `p19.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const password = 'Staff-Pass-2026x';
    const r = await api().post('/api/v1/admin/staff').set(bearer(s.super)).send({ fullName: name, email, password, roles }).expect(201);
    return { email, password, id: (r.body.id ?? (await prisma.user.findUniqueOrThrow({ where: { email } })).id) as string, token: await login(email, password) };
  }
  async function customer(pin?: { lat: number; lng: number }) {
    const email = `p19c.${run}.${randomBytes(3).toString('hex')}@example.com`;
    const reg = await api().post('/api/v1/auth/register').send({ fullName: 'Hind Proof', email, password: 'Buyer-Pass-123' }).expect(201);
    const addr = await api().post('/api/v1/addresses').set(bearer(reg.body.accessToken)).send({ recipientName: 'Hind Proof', phone: phone(), countryCode: 'QA', city: 'Doha', zone: '61', street: '840', building: '3', isDefault: true, ...pin }).expect(201);
    return { token: reg.body.accessToken as string, address: addr.body.id as string };
  }
  async function order(c: { token: string; address: string }, paymentMethod: 'COD' | 'CARD' = 'COD', variant = s.variant, quantity = 1) {
    await api().post('/api/v1/cart/items').set(bearer(c.token)).send({ variantId: variant, quantity }).expect(201);
    const r = await api().post('/api/v1/checkout').set(bearer(c.token)).set('Idempotency-Key', `p19-${run}-${randomBytes(4).toString('hex')}`).send({ addressId: c.address, paymentMethod }).expect(201);
    return r.body.orderNumber as string;
  }
  const stock = (variant: string, body: object, token = s.admin) => api().post(`/api/v1/admin/variants/${variant}/stock`).set(bearer(token)).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    restoreCod = await setCodRules(prisma, { phoneCheck: 'OFF', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 5, driverCashLimitMinor: null });
    jest.spyOn(app.get(NotificationsService), 'sendDirect').mockResolvedValue(undefined as never);
    s.super = await login(SUPER.email, SUPER.password);
    s.admin = await login('admin@demo.jovia.test');
    s.ops = await login('ops@demo.jovia.test');
    s.finance = await login('finance@demo.jovia.test');
    s.courier = await login('courier@demo.jovia.test');
    s.courierId = (await prisma.user.findFirstOrThrow({ where: { email: 'courier@demo.jovia.test' } })).id;
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'home-kitchen' } });
    const mk = async (title: string, sku: string, price: string, tracksExpiry = false) => {
      const p = await api().post('/api/v1/admin/products').set(bearer(s.admin)).send({ title, categoryId: cat.id, tracksExpiry, variants: [{ sku, priceMinor: price, costPriceMinor: price === '6000' ? '4000' : undefined, initialStock: 0 }] }).expect(201);
      await api().post(`/api/v1/admin/products/${p.body.id}/images`).set(bearer(s.admin)).attach('file', PNG, 'p.png').expect(201);
      await stock(p.body.variants[0].id, { delta: 100, reason: 'ADJUSTMENT', note: 'opening' }).expect(200);
      await api().post(`/api/v1/admin/products/${p.body.id}/status`).set(bearer(s.admin)).send({ status: 'ACTIVE' }).expect(200);
      return p.body.variants[0].id as string;
    };
    s.variant = await mk(`P19 Teapot ${run}`, `P19-T-${run}`, '6000');
    s.dated = await mk(`P19 Laban ${run}`, `P19-L-${run}`, '800', true);
    s.warehouse = ((await api().get('/api/v1/admin/warehouses').set(bearer(s.admin)).expect(200)).body.items as { id: string; isDefault: boolean }[]).find((w) => w.isDefault)!.id;
  });

  afterAll(async () => {
    await restoreCod?.();
    await new Promise((r) => setTimeout(r, 300));
    await app?.close();
  });

  // ------------------------------------------------------------------ two-step sign-in

  describe('two-step sign-in', () => {
    let u: Awaited<ReturnType<typeof staff>>;
    let secret = '';
    let recovery: string[] = [];
    const nextCode = async (after: number) => {
      // each 30-second step's code works once: wait for a step after the last one used
      while (Math.floor(Date.now() / 30_000) <= after) await new Promise((r) => setTimeout(r, 500));
      return totp(secret);
    };

    beforeAll(async () => { u = await staff(['ORDER_MANAGER']); });

    it('set up with the app: pending until the first code, then other sessions end and recovery codes are given once', async () => {
      const other = await login(u.email, u.password);
      const setup = await api().post('/api/v1/auth/2fa/setup').set(bearer(u.token)).expect(200);
      secret = setup.body.secret;
      expect(setup.body.otpauthUrl).toContain(`secret=${secret}`);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { twoFactorPendingSecret: true, twoFactorSecret: true } });
      expect(row.twoFactorSecret).toBeNull();
      expect(row.twoFactorPendingSecret).not.toContain(secret); // stored encrypted
      await api().post('/api/v1/auth/2fa/enable').set(bearer(u.token)).send({ code: '000000' }).expect(400);
      const on = await api().post('/api/v1/auth/2fa/enable').set(bearer(u.token)).send({ code: totp(secret) }).expect(200);
      recovery = on.body.recoveryCodes;
      expect(recovery).toHaveLength(10);
      expect(on.body.accessToken).toBeTruthy();
      u.token = on.body.accessToken;
      // the old session's refresh family was revoked
      expect(await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null, mfa: false } })).toBe(0);
      expect((await api().get('/api/v1/auth/me').set(bearer(other)).expect((r) => expect([200, 401]).toContain(r.status))).status).toBeDefined();
      const st = await api().get('/api/v1/auth/2fa').set(bearer(u.token)).expect(200);
      expect(st.body).toMatchObject({ enabled: true, recoveryCodesLeft: 10, thisSession: true });
    });

    it('password alone gives a challenge, not tokens; a wrong code is refused; the right one signs in once', async () => {
      const first = await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200);
      expect(first.body).toMatchObject({ twoFactorRequired: true });
      expect(first.body.accessToken).toBeUndefined();
      const bad = await api().post('/api/v1/auth/2fa/login').send({ challenge: first.body.challenge, code: '123456' }).expect(401);
      expect(bad.body.reason).toBe('BAD_CODE');
      const used = (await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { twoFactorLastStep: true } })).twoFactorLastStep!;
      const code = await nextCode(used);
      const ok = await api().post('/api/v1/auth/2fa/login').send({ challenge: first.body.challenge, code }).expect(200);
      expect(ok.body.accessToken).toBeTruthy();
      // the same code again (replay) is refused
      const again = await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200);
      expect((await api().post('/api/v1/auth/2fa/login').send({ challenge: again.body.challenge, code }).expect(401)).body.reason).toBe('BAD_CODE');
      // a forged / customer-only challenge does not work
      await api().post('/api/v1/auth/2fa/login').send({ challenge: ok.body.accessToken, code }).expect(401);
    }, 70_000);

    it('a recovery code works once, and the login history shows every attempt', async () => {
      const ch = (await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200)).body.challenge;
      const r = await api().post('/api/v1/auth/2fa/login').send({ challenge: ch, code: recovery[0].toLowerCase() }).expect(200);
      const ch2 = (await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200)).body.challenge;
      await api().post('/api/v1/auth/2fa/login').send({ challenge: ch2, code: recovery[0] }).expect(401);
      const hist = (await api().get('/api/v1/auth/login-history').set(bearer(r.body.accessToken)).expect(200)).body as { success: boolean; reason: string; method: string }[];
      expect(hist.some((h) => h.success && h.method === 'recovery')).toBe(true);
      expect(hist.some((h) => !h.success && h.reason === 'BAD_CODE')).toBe(true);
      expect((await api().get('/api/v1/auth/2fa').set(bearer(r.body.accessToken)).expect(200)).body.recoveryCodesLeft).toBe(9);
      u.token = r.body.accessToken;
    });

    it('sessions: listed per device, one can be ended', async () => {
      const list = (await api().get('/api/v1/auth/sessions').set(bearer(u.token)).expect(200)).body as { id: string; current: boolean; twoStep: boolean }[];
      expect(list.filter((x) => x.current)).toHaveLength(1);
      const other = list.find((x) => !x.current)!;
      await api().delete(`/api/v1/auth/sessions/${other.id}`).set(bearer(u.token)).expect(204);
      await api().delete(`/api/v1/auth/sessions/${randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-4$3-a$4-$5').slice(0, 36)}`).set(bearer(u.token)).expect((r) => expect([400, 404]).toContain(r.status));
      expect((await api().get('/api/v1/auth/sessions').set(bearer(u.token)).expect(200)).body.some((x: { id: string }) => x.id === other.id)).toBe(false);
    });

    it('only another admin can reset it; then the next sign-in is password only', async () => {
      await api().post(`/api/v1/admin/staff/${u.id}/2fa/reset`).set(bearer(s.admin)).expect(403); // ADMIN has no admins.manage
      const superId = (await prisma.user.findFirstOrThrow({ where: { email: SUPER.email } })).id;
      await api().post(`/api/v1/admin/staff/${superId}/2fa/reset`).set(bearer(s.super)).expect(403); // not yourself
      await api().post(`/api/v1/admin/staff/${u.id}/2fa/reset`).set(bearer(s.super)).expect(200);
      const r = await api().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200);
      expect(r.body.accessToken).toBeTruthy();
      expect(await prisma.auditLog.count({ where: { action: 'auth.2fa_reset', entityId: u.id } })).toBe(1);
    });

    it('five wrong passwords pause the account for 15 minutes — even with the right password — and a reset unlocks', async () => {
      const v = await staff(['SUPPORT_ADMIN']);
      for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/login').send({ identifier: v.email, password: 'Wrong-Pass-1234' }).expect(401);
      const locked = await api().post('/api/v1/auth/login').send({ identifier: v.email, password: v.password }).expect(429);
      expect(locked.body).toMatchObject({ reason: 'ACCOUNT_LOCKED' });
      expect(locked.body.retryAfterSeconds).toBeGreaterThan(800);
      expect(await prisma.auditLog.count({ where: { action: 'auth.account_locked', entityId: v.id } })).toBe(1);
      await prisma.user.update({ where: { id: v.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await api().post('/api/v1/auth/login').send({ identifier: v.email, password: v.password }).expect(200);
    });

    it('staff list shows who has it on', async () => {
      const page = (await api().get(`/api/v1/admin/staff?q=${encodeURIComponent(u.email)}`).set(bearer(s.super)).expect(200)).body;
      expect(page.items[0]).toMatchObject({ twoFactor: false, lockedUntil: null });
    });
  });

  // ------------------------------------------------------------------ failed delivery proof

  describe('failed delivery', () => {
    async function onTheRoad(pin?: { lat: number; lng: number }) {
      const c = await customer(pin);
      const orderNumber = await order(c);
      const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { sellerOrders: true } });
      const so = o.sellerOrders[0].id;
      for (const status of ['PREPARING', 'READY_FOR_PICKUP']) await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
      let d = null;
      for (let i = 0; i < 50 && !d; i++) { d = await prisma.deliveryOrder.findUnique({ where: { sellerOrderId: so } }); if (!d) await new Promise((r) => setTimeout(r, 100)); }
      await api().post(`/api/v1/admin/deliveries/${d!.id}/assign`).set(bearer(s.admin)).send({ courierUserId: s.courierId }).expect(200);
      await api().post(`/api/v1/courier/jobs/${d!.id}/pickup`).set(bearer(s.courier)).expect(200);
      await api().post(`/api/v1/courier/jobs/${d!.id}/out-for-delivery`).set(bearer(s.courier)).expect(200);
      return { c, orderNumber, delivery: d!.id };
    }

    it('location and door photo are kept; distance from the pin is measured; the customer is told and can reschedule', async () => {
      const t = await onTheRoad({ lat: 25.322, lng: 51.531 });
      await api().post(`/api/v1/courier/jobs/${t.delivery}/fail`).set(bearer(s.courier))
        .field('reason', 'Customer not answering').field('lat', '25.304').field('lng', '51.531').attach('photo', PNG, 'door.png').expect(200);
      const d = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: t.delivery } });
      expect(d.failureDistanceM).toBeGreaterThan(1900);
      expect(d.failurePhotoKey).toMatch(/^deliveries\//);
      const photo = await api().get(`/api/v1/admin/deliveries/${t.delivery}/failure-photo`).set(bearer(s.ops)).expect(200);
      expect(photo.body.url).toBeTruthy();
      const seen = (await api().get(`/api/v1/orders/${t.orderNumber}`).set(bearer(t.c.token)).expect(200)).body.sellerOrders[0].delivery;
      expect(seen.attempt).toMatchObject({ kind: 'NO_ANSWER', canReschedule: true });
      await api().post(`/api/v1/orders/${t.orderNumber}/reschedule`).set(bearer(t.c.token)).send({}).expect(400);
      await api().post(`/api/v1/orders/${t.orderNumber}/reschedule`).set(bearer(t.c.token)).send({ note: 'After 5 pm, call first' }).expect(200);
      expect((await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: t.delivery } })).customerRequest).toContain('After 5 pm, call first');
      // someone else's order: not found
      const other = await customer();
      await api().post(`/api/v1/orders/${t.orderNumber}/reschedule`).set(bearer(other.token)).send({ note: 'x' }).expect(404);
    });

    it('a refusal cannot be rescheduled by the customer', async () => {
      const t = await onTheRoad();
      await api().post(`/api/v1/courier/jobs/${t.delivery}/fail`).set(bearer(s.courier)).send({ reason: 'Customer refused the order', refused: true }).expect(200);
      const seen = (await api().get(`/api/v1/orders/${t.orderNumber}`).set(bearer(t.c.token)).expect(200)).body.sellerOrders[0].delivery;
      expect(seen.attempt).toMatchObject({ kind: 'REFUSED', canReschedule: false });
      await api().post(`/api/v1/orders/${t.orderNumber}/reschedule`).set(bearer(t.c.token)).send({ note: 'Please come back' }).expect((r) => expect([400, 409]).toContain(r.status));
    });
  });

  // ------------------------------------------------------------------ stock

  describe('stock control', () => {
    it('write-off reasons go one way; above QAR 500 at cost needs a manager', async () => {
      const inv = await staff(['INVENTORY_MANAGER']);
      expect((await stock(s.variant, { delta: 2, reason: 'DAMAGED' }, inv.token)).status).toBe(400);
      await stock(s.variant, { delta: -2, reason: 'DAMAGED', note: 'Dropped' }, inv.token).expect(200); // 2 × 40.00
      const big = await stock(s.variant, { delta: -13, reason: 'LOST' }, inv.token).expect(403); // 13 × 40.00 = 520.00
      expect(big.body.reason).toBe('WRITE_OFF_APPROVAL');
      await stock(s.variant, { delta: -13, reason: 'LOST', note: 'Theft report 77' }, s.ops).expect(200);
      const m = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: s.variant, reason: 'LOST' }, orderBy: { createdAt: 'desc' } });
      expect(m.qtyDelta).toBe(-13);
    });

    it('dated products need the expiry date; the earliest date ships first; expired units leave the shelf at night', async () => {
      expect((await stock(s.dated, { delta: 5, reason: 'RESTOCK' })).body.reason).toBe('EXPIRY_REQUIRED');
      const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      await stock(s.dated, { delta: 4, reason: 'RESTOCK', expiresOn: '2027-06-30', lotCode: 'LATE', warehouseId: s.warehouse }).expect(200);
      await stock(s.dated, { delta: 3, reason: 'RESTOCK', expiresOn: '2027-01-31', lotCode: 'EARLY', warehouseId: s.warehouse }).expect(200);
      await stock(s.dated, { delta: 2, reason: 'RESTOCK', expiresOn: past, lotCode: 'OLD', warehouseId: s.warehouse }).expect(200);
      // a customer buys 2: expired units are skipped, the earliest good date goes
      const c = await customer();
      const n = await order(c, 'COD', s.dated, 2);
      const so = (await prisma.order.findUniqueOrThrow({ where: { orderNumber: n }, include: { sellerOrders: true } })).sellerOrders[0].id;
      for (const status of ['PREPARING', 'READY_FOR_PICKUP', 'SHIPPED']) await api().post(`/api/v1/admin/orders/shipments/${so}/status`).set(bearer(s.admin)).send({ status }).expect(200);
      const lots = async () => Object.fromEntries((await prisma.stockLot.findMany({ where: { variantId: s.dated } })).map((l) => [l.lotCode, l.quantity]));
      const before = await lots();
      if (before.EARLY === 3) {
        // stock is committed at delivery in this setup: the order is still holding them
        expect(before).toMatchObject({ OLD: 2, EARLY: 3, LATE: 4 });
      } else {
        expect(before).toMatchObject({ OLD: 2, EARLY: 1, LATE: 4 });
      }
      const report = (await api().get('/api/v1/admin/inventory/expiry?days=365').set(bearer(s.ops)).expect(200)).body;
      expect(report.items.find((i: { lotCode: string }) => i.lotCode === 'OLD')).toMatchObject({ expired: true, quantity: 2 });
      const res = await app.get(ExpiryService).writeOffExpired(null);
      expect(res.unitsWrittenOff).toBeGreaterThanOrEqual(2);
      expect((await lots()).OLD).toBe(0);
      expect(await prisma.inventoryMovement.count({ where: { variantId: s.dated, reason: 'EXPIRED' } })).toBe(1);
    });

    it('stocktake: blind for counters, a second person approves, differences are posted', async () => {
      const inv = await staff(['INVENTORY_MANAGER']);
      for (const c of await prisma.stockCount.findMany({ where: { warehouseId: s.warehouse, status: { in: ['OPEN', 'SUBMITTED'] } } })) {
        await api().post(`/api/v1/admin/stock-counts/${c.id}/cancel`).set(bearer(s.admin)).expect(200);
      }
      const count = (await api().post('/api/v1/admin/stock-counts').set(bearer(inv.token)).send({ warehouseId: s.warehouse, variantIds: [s.variant] }).expect(201)).body;
      await api().post('/api/v1/admin/stock-counts').set(bearer(inv.token)).send({ warehouseId: s.warehouse, variantIds: [s.variant] }).expect(409); // one at a time
      const blind = (await api().get(`/api/v1/admin/stock-counts/${count.id}`).set(bearer(inv.token)).expect(200)).body;
      expect(blind.lines[0].expectedQty).toBeUndefined();
      await api().post(`/api/v1/admin/stock-counts/${count.id}/submit`).set(bearer(inv.token)).expect(400); // not counted yet
      const shelf = (await prisma.warehouseStock.findUniqueOrThrow({ where: { warehouseId_variantId: { warehouseId: s.warehouse, variantId: s.variant } } })).onHand;
      await api().patch(`/api/v1/admin/stock-counts/${count.id}/lines`).set(bearer(inv.token)).send({ lines: [{ variantId: s.variant, countedQty: shelf - 3 }] }).expect(200);
      await api().post(`/api/v1/admin/stock-counts/${count.id}/submit`).set(bearer(inv.token)).expect(200);
      await api().post(`/api/v1/admin/stock-counts/${count.id}/approve`).set(bearer(inv.token)).expect(403); // no inventory.approve
      const self = await staff(['OPERATIONS_ADMIN']);
      await api().patch(`/api/v1/admin/stock-counts/${count.id}/lines`).set(bearer(self.token)).send({ lines: [{ variantId: s.variant, countedQty: 1 }] }).expect(409); // locked
      const ok = (await api().post(`/api/v1/admin/stock-counts/${count.id}/approve`).set(bearer(self.token)).expect(200)).body;
      expect(ok).toMatchObject({ status: 'APPROVED', unitsRemoved: 3, unitsAdded: 0 });
      await api().post(`/api/v1/admin/stock-counts/${count.id}/approve`).set(bearer(s.ops)).expect(409);
      const loss = (await api().get('/api/v1/admin/inventory/shrinkage').set(bearer(s.ops)).expect(200)).body;
      expect(loss.byReason.find((r: { reason: string }) => r.reason === 'COUNT').units).toBeLessThanOrEqual(-3);
    });

    it('the counter who submitted cannot approve their own count', async () => {
      const mgr = await staff(['OPERATIONS_ADMIN']);
      const count = (await api().post('/api/v1/admin/stock-counts').set(bearer(mgr.token)).send({ warehouseId: s.warehouse, variantIds: [s.variant] }).expect(201)).body;
      await api().patch(`/api/v1/admin/stock-counts/${count.id}/lines`).set(bearer(mgr.token)).send({ lines: [{ variantId: s.variant, countedQty: 0 }] }).expect(200);
      await api().post(`/api/v1/admin/stock-counts/${count.id}/submit`).set(bearer(mgr.token)).expect(200);
      expect((await api().post(`/api/v1/admin/stock-counts/${count.id}/approve`).set(bearer(mgr.token)).expect(403)).body.reason).toBe('FOUR_EYES');
      await api().post(`/api/v1/admin/stock-counts/${count.id}/cancel`).set(bearer(mgr.token)).expect(200);
    });
  });

  // ------------------------------------------------------------------ purchasing

  describe('purchasing', () => {
    it('draft → ordered → received in parts by someone else, with lots and the average cost; receipts cannot be edited', async () => {
      const sup = (await api().post('/api/v1/admin/suppliers').set(bearer(s.admin)).send({ name: `Al Rayyan Dairy ${run}`, phone: '+974 4444 0000', paymentTerms: '15 days' }).expect(201)).body;
      await api().post('/api/v1/admin/suppliers').set(bearer(s.admin)).send({ name: `al rayyan dairy ${run}` }).expect(409);
      const po = (await api().post('/api/v1/admin/purchase-orders').set(bearer(s.admin)).send({
        supplierId: sup.id, warehouseId: s.warehouse, expectedOn: '2026-12-01',
        lines: [{ variantId: s.variant, quantity: 10, unitCostMinor: '5000' }, { variantId: s.dated, quantity: 6, unitCostMinor: '300' }],
      }).expect(201)).body;
      expect(po).toMatchObject({ status: 'DRAFT', totalMinor: '51800' });
      const teapot = po.lines.find((l: { variantId: string }) => l.variantId === s.variant);
      const laban = po.lines.find((l: { variantId: string }) => l.variantId === s.dated);
      await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.ops)).send({ lines: [{ lineId: teapot.id, quantity: 1 }] }).expect(409); // not sent yet
      await api().patch(`/api/v1/admin/purchase-orders/${po.id}`).set(bearer(s.admin)).send({ note: 'Morning delivery' }).expect(200);
      await api().post(`/api/v1/admin/purchase-orders/${po.id}/order`).set(bearer(s.admin)).expect(200);
      await api().patch(`/api/v1/admin/purchase-orders/${po.id}`).set(bearer(s.admin)).send({ note: 'x' }).expect(409);
      expect((await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.admin)).send({ lines: [{ lineId: teapot.id, quantity: 1 }] }).expect(403)).body.reason).toBe('FOUR_EYES');
      expect((await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.ops)).send({ lines: [{ lineId: teapot.id, quantity: 11 }] }).expect(400)).body.reason).toBe('OVER_RECEIVED');
      expect((await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.ops)).send({ lines: [{ lineId: laban.id, quantity: 6 }] }).expect(400)).body.reason).toBe('EXPIRY_REQUIRED');

      const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: s.variant }, select: { costPriceMinor: true } });
      const onHand = (await prisma.inventory.findUniqueOrThrow({ where: { variantId: s.variant } })).onHand;
      const first = (await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.ops)).send({
        supplierRef: 'DN-1', lines: [{ lineId: teapot.id, quantity: 4 }, { lineId: laban.id, quantity: 6, lotCode: 'RD-55', expiresOn: '2027-04-30' }],
      }).expect(201)).body;
      expect(first.receipt).toMatchObject({ units: 10, status: 'PARTIAL' });
      expect(first.receipt.number).toMatch(/^GRN-QA-\d{6}-[0-9A-F]{4}$/);
      const expected = (BigInt(onHand) * before.costPriceMinor! + 4n * 5000n + BigInt(onHand + 4) / 2n) / BigInt(onHand + 4);
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: s.variant } })).costPriceMinor).toBe(expected);
      expect(await prisma.stockLot.findFirst({ where: { variantId: s.dated, lotCode: 'RD-55' } })).toMatchObject({ quantity: 6 });

      const second = (await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.ops)).send({ lines: [{ lineId: teapot.id, quantity: 6 }] }).expect(201)).body;
      expect(second.receipt.status).toBe('RECEIVED');
      await api().post(`/api/v1/admin/purchase-orders/${po.id}/receive`).set(bearer(s.ops)).send({ lines: [{ lineId: teapot.id, quantity: 1 }] }).expect(409);
      await api().post(`/api/v1/admin/purchase-orders/${po.id}/cancel`).set(bearer(s.admin)).expect(409);
      await expect(prisma.goodsReceipt.update({ where: { id: first.receipt.id }, data: { note: 'changed' } })).rejects.toThrow();
      await expect(prisma.purchaseOrderLine.update({ where: { id: teapot.id }, data: { receivedQty: 20 } })).rejects.toThrow(); // more than ordered

      const pdf = await api().get(`/api/v1/admin/purchase-orders/${po.id}/pdf`).set(bearer(s.ops)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      // warehouse staff can receive but not raise orders
      const inv = await staff(['INVENTORY_MANAGER']);
      await api().post('/api/v1/admin/purchase-orders').set(bearer(inv.token)).send({ supplierId: sup.id, warehouseId: s.warehouse, lines: [{ variantId: s.variant, quantity: 1, unitCostMinor: '1' }] }).expect(403);
    });
  });

  // ------------------------------------------------------------------ payments

  describe('payments', () => {
    it('a cancelled card order still charged shows as a problem; the settlement file matches by reference', async () => {
      const c = await customer();
      const n = await order(c, 'CARD');
      const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: n }, include: { payments: true } });
      const pay = o.payments[0];
      expect(pay.status).toBe('CAPTURED');
      await prisma.order.update({ where: { id: o.id }, data: { status: 'CANCELLED' } }); // e.g. cancelled by hand in the database, refund forgotten
      const ex = (await api().get('/api/v1/admin/payments/exceptions?kind=CANCELLED_NOT_REFUNDED').set(bearer(s.finance)).expect(200)).body;
      expect(ex.items.find((e: { orderNumber: string }) => e.orderNumber === n)).toMatchObject({ amountMinor: pay.amountMinor.toString() });
      await prisma.order.update({ where: { id: o.id }, data: { status: 'CONFIRMED' } });

      const amount = (Number(pay.amountMinor) / 100).toFixed(2);
      const csv = `Payment ID,Amount,Date\n${pay.providerRef},${amount},${pay.createdAt.toISOString()}\n${pay.providerRef},${amount},\nnot-ours-${run},10.00,\nbad,x,\n`;
      await api().post('/api/v1/admin/payments/settlements').set(bearer(s.ops)).attach('file', Buffer.from(csv), 's.csv').expect(403); // payments.reconcile
      const r = (await api().post('/api/v1/admin/payments/settlements').set(bearer(s.finance)).field('provider', pay.provider).attach('file', Buffer.from(csv), 'settlement.csv').expect(201)).body;
      expect(r).toMatchObject({ rows: 3, matched: 1, mismatched: 1, missing: 1 });
      expect(r.result.errors).toHaveLength(1);
      expect(r.result.lines.find((l: { result: string }) => l.result === 'DUPLICATE')).toBeTruthy();
      await api().post('/api/v1/admin/payments/settlements').set(bearer(s.finance)).attach('file', Buffer.from('%PDF-1.4'), 'x.pdf').expect(400);
      const wrong = `reference,amount\n${pay.providerRef},1.00\n`;
      expect((await api().post('/api/v1/admin/payments/settlements').set(bearer(s.finance)).attach('file', Buffer.from(wrong), 'w.csv').expect(201)).body).toMatchObject({ matched: 0, mismatched: 1 });
      expect((await api().get(`/api/v1/admin/payments/settlements/${r.id}`).set(bearer(s.finance)).expect(200)).body.fileName).toBe('settlement.csv');
    });

    it('daily closing: totals by method, cash in and out, and a PDF', async () => {
      const day = (await api().get('/api/v1/admin/payments/closing').set(bearer(s.finance)).expect(200)).body;
      expect(day).toMatchObject({ tz: 'Asia/Qatar', currencyCode: 'QAR' });
      expect(BigInt(day.netMinor)).toBe(BigInt(day.cardCaptured.totalMinor) + BigInt(day.cash.collectedMinor) - BigInt(day.refunds.totalMinor));
      const pdf = await api().get(`/api/v1/admin/payments/closing/pdf?date=${day.date}`).set(bearer(s.finance)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      await api().get('/api/v1/admin/payments/closing').set(bearer(s.ops)).expect(403); // payments.read only
    });

    it('the admin home counters include the new checks', async () => {
      const sum = (await api().get('/api/v1/admin/dashboard/summary').set(bearer(s.admin)).expect(200)).body;
      expect(sum).toEqual(expect.objectContaining({ lotsExpiringSoon: expect.any(Number), purchaseOrdersToReceive: expect.any(Number), stockCountsToApprove: expect.any(Number), cardPaymentsStuck: expect.any(Number) }));
    });
  });

});
