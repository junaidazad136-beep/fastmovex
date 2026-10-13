import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertRoleChange, AdminUsersService } from '../src/admin/admin-users';
import { csvCell, ExportService, toCsv } from '../src/analytics/export.service';
import { resolveRange } from '../src/analytics/range';
import { codeMatches, courierCan, deliveryStatusFor, firstName } from '../src/delivery/delivery-rules';
import { DeliveryService } from '../src/delivery/delivery.service';
import { assertDealPrice } from '../src/marketing/marketing';

const audit = { log: jest.fn() };

describe('analytics date ranges (market time zone)', () => {
  const now = new Date('2026-09-22T22:30:00Z'); // 01:30 on 23 Sep in Doha

  it('"today" starts at Doha midnight, not server midnight', () => {
    const r = resolveRange('today', now, 'QA');
    expect(r.from.toISOString()).toBe('2026-09-22T21:00:00.000Z');
    expect(r.bucket).toBe('hour');
  });
  it('"yesterday" is the full previous Doha day', () => {
    const r = resolveRange('yesterday', now, 'QA');
    expect([r.from.toISOString(), r.to.toISOString()]).toEqual(['2026-09-21T21:00:00.000Z', '2026-09-22T21:00:00.000Z']);
  });
  it('Dubai (UTC+4) differs from Doha', () => {
    expect(resolveRange('today', now, 'AE').from.toISOString()).toBe('2026-09-22T20:00:00.000Z');
  });
  it('7 days includes today; buckets scale with range', () => {
    expect(resolveRange('7d', now, 'QA').from.toISOString()).toBe('2026-09-16T21:00:00.000Z');
    expect(resolveRange('30d', now, 'QA').bucket).toBe('day');
    expect(resolveRange('3m', now, 'QA').bucket).toBe('week');
    expect(resolveRange('12m', now, 'QA').bucket).toBe('month');
  });
  it('custom range is inclusive of the end date and capped at 2 years', () => {
    const r = resolveRange('custom', now, 'QA', { from: '2026-09-01', to: '2026-09-30' });
    expect([r.from.toISOString(), r.to.toISOString()]).toEqual(['2026-08-31T21:00:00.000Z', '2026-09-30T21:00:00.000Z']);
    expect(() => resolveRange('custom', now, 'QA', { from: '2020-01-01', to: '2026-01-01' })).toThrow('2 years');
    expect(() => resolveRange('custom', now, 'QA', { from: '2026-09-30', to: '2026-09-01' })).toThrow(BadRequestException);
    expect(() => resolveRange('custom', now, 'QA', {})).toThrow('YYYY-MM-DD');
  });
});

describe('exports', () => {
  it('neutralises spreadsheet formula injection', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+971')).toBe("'+971");
    expect(csvCell(-5)).toBe('-5'); // real negative numbers stay numbers
    expect(csvCell('Doha, Qatar')).toBe('"Doha, Qatar"');
  });
  it('CSV has a BOM so Arabic opens correctly in Excel', () => {
    expect(toCsv({ title: 't', columns: ['Name'], rows: [['عطر']] }).startsWith('\uFEFFName')).toBe(true);
  });
  it('produces real Excel and PDF files', async () => {
    const svc = new ExportService();
    const t = { title: 'Top products', columns: ['Name', 'GMV'], rows: [['Oud', '10000'], ['=cmd', '5']] };
    const xlsx = await svc.render(t, 'xlsx');
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe('PK'); // zip container
    const pdf = await svc.render(t, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('delivery rules', () => {
  it('maps shipment status to delivery status', () => {
    expect(deliveryStatusFor('READY_FOR_PICKUP', false)).toBe('CREATED');
    expect(deliveryStatusFor('SHIPPED', false)).toBe('IN_TRANSIT'); // seller delivers
    expect(deliveryStatusFor('SHIPPED', true, 'FASTMOVEX')).toBe('PICKED_UP'); // courier collected
    expect(deliveryStatusFor('PREPARING', false)).toBeNull();
  });
  it('courier can only move forward', () => {
    expect(courierCan('ASSIGNED', 'PICKED_UP')).toBe(true);
    expect(courierCan('ASSIGNED', 'DELIVERED')).toBe(false);
    expect(courierCan('OUT_FOR_DELIVERY', 'FAILED')).toBe(true);
  });
  it('code check', () => {
    expect(codeMatches('4821', '4821')).toBe(true);
    expect(codeMatches('4821', '4822')).toBe(false);
    expect(codeMatches(null, '4821')).toBe(false);
    expect(firstName('Ahmed Al Thani')).toBe('Ahmed');
  });
});

describe('DeliveryService', () => {
  const orders = { setSellerOrderStatus: jest.fn() };
  const storage = { put: jest.fn(), signedUrl: jest.fn() };
  const make = (prisma: object) => new DeliveryService(prisma as never, orders as never, storage as never, audit as never);

  it('"ready for pickup" opens a FastMoveX-fleet job with a delivery code', async () => {
    const create = jest.fn();
    const prisma = {
      sellerOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'so', status: 'READY_FOR_PICKUP', delivery: null }), update: jest.fn() },
      deliveryOrder: { create },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    await make(prisma).sync('so');
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ method: 'FASTMOVEX', providerCode: 'fastmovex_fleet', status: 'CREATED' });
    expect(data.deliveryCode).toMatch(/^\d{4}$/);
  });

  it('no-op when already in sync (no event loop with courier actions)', async () => {
    const update = jest.fn();
    const prisma = { sellerOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'so', status: 'OUT_FOR_DELIVERY', delivery: { id: 'd', status: 'OUT_FOR_DELIVERY', method: 'FASTMOVEX' } }) }, deliveryOrder: { update } };
    await make(prisma).sync('so');
    expect(update).not.toHaveBeenCalled();
  });

  const job = (o: object = {}) => ({ id: 'd', status: 'OUT_FOR_DELIVERY', courierUserId: 'courier-1', sellerOrderId: 'so', deliveryCode: '4821', attempts: 0, ...o });

  it("a courier cannot touch another courier's job", async () => {
    const prisma = { deliveryOrder: { findUnique: jest.fn().mockResolvedValue(job({ courierUserId: 'courier-2' })) } };
    await expect(make(prisma).pickup('d', 'courier-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('wrong code is counted; 5 wrong codes lock the job', async () => {
    const update = jest.fn();
    await expect(make({ deliveryOrder: { findUnique: jest.fn().mockResolvedValue(job()), update } }).deliver('d', 'courier-1', '0000')).rejects.toThrow('Wrong delivery code');
    expect(update).toHaveBeenCalledWith({ where: { id: 'd' }, data: { attempts: { increment: 1 } } });
    await expect(make({ deliveryOrder: { findUnique: jest.fn().mockResolvedValue(job({ attempts: 5 })) } }).deliver('d', 'courier-1', '4821')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('correct code delivers and moves the shipment as SYSTEM', async () => {
    const prisma = {
      deliveryOrder: { findUnique: jest.fn().mockResolvedValue(job()), update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd', status: 'DELIVERED' }) },
      sellerOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'OUT_FOR_DELIVERY' }) },
    };
    await make(prisma).deliver('d', 'courier-1', '4821', 'Front desk');
    expect(orders.setSellerOrderStatus).toHaveBeenCalledWith('so', 'DELIVERED', 'SYSTEM', 'courier-1', 'Delivered, code verified');
  });

  it('only active delivery agents can be assigned', async () => {
    const prisma = { deliveryOrder: { findUnique: jest.fn().mockResolvedValue({ status: 'CREATED', method: 'FASTMOVEX' }) }, user: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(make(prisma).assign('d', 'random-user', 'admin')).rejects.toThrow('not an active delivery agent');
  });

  it('tracking: courier location only while out for delivery; code hidden after delivery', async () => {
    const shipment = (status: string) => ({
      status: 'X', seller: { store: { name: 'S' } },
      delivery: { method: 'FASTMOVEX', status, trackingUrl: null, etaAt: null, courierName: 'Ahmed Khan', lastLat: 25.3, lastLng: 51.5, deliveryCode: '4821', deliveredAt: null, events: [] },
    });
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue({ orderNumber: 'JV', status: 'SHIPPED', sellerOrders: [shipment('PICKED_UP'), shipment('OUT_FOR_DELIVERY'), shipment('DELIVERED')] }) } };
    const t = await make(prisma).tracking('u', 'JV');
    expect(t.shipments[0].delivery?.location).toBeNull();
    expect(t.shipments[1].delivery?.location).toEqual({ lat: 25.3, lng: 51.5 });
    expect(t.shipments[1].delivery?.courier).toBe('Ahmed');
    expect(t.shipments[2].delivery?.deliveryCode).toBeNull();
  });
});

describe('marketing', () => {
  it('a deal must be a real discount', () => {
    expect(() => assertDealPrice(10000n, 10000n)).toThrow('lower');
    expect(() => assertDealPrice(0n, 10000n)).toThrow('above zero');
    expect(() => assertDealPrice(7900n, 10000n)).not.toThrow();
  });
});

describe('admin access guard rails', () => {
  const admin = { id: 'a1', roles: ['ADMIN'], permissions: [] };
  const superAdmin = { id: 's1', roles: ['SUPER_ADMIN'], permissions: [] };

  it('nobody edits their own roles', () => expect(() => assertRoleChange(superAdmin, 's1', ['SUPER_ADMIN'], [], 3)).toThrow(ForbiddenException));
  it('only super admins grant super admin', () => expect(() => assertRoleChange(admin, 'x', ['SUPPORT_ADMIN'], ['SUPER_ADMIN'], 2)).toThrow('Only a super admin'));
  it('the last super admin cannot be demoted', () => expect(() => assertRoleChange(superAdmin, 's2', ['SUPER_ADMIN'], ['ADMIN'], 1)).toThrow('last super admin'));
  it('normal promotion works', () => expect(() => assertRoleChange(admin, 'x', ['CUSTOMER'], ['CUSTOMER', 'SUPPORT_ADMIN'], 2)).not.toThrow());

  const svc = (prisma: object, tokens = { revokeAllForUser: jest.fn() }) => new AdminUsersService(prisma as never, {} as never, tokens as never, audit as never);
  it('cannot suspend yourself', async () => {
    await expect(svc({}).setStatus('a1', { status: 'SUSPENDED', reason: 'test' }, admin)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('suspending a user logs them out everywhere', async () => {
    const tokens = { revokeAllForUser: jest.fn() };
    const prisma = { userRole: { findMany: jest.fn().mockResolvedValue([{ role: { code: 'CUSTOMER' } }]) }, user: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) } };
    await svc(prisma, tokens).setStatus('u9', { status: 'SUSPENDED', reason: 'fraud' }, admin);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u9');
    // the audit entry says what it was before and why (Phase 23 audit review)
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.suspended', before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED', reason: 'fraud' } }));
  });
  it('super admin permissions cannot be edited', async () => {
    await expect(svc({}).setRolePermissions('SUPER_ADMIN', [], superAdmin)).rejects.toThrow('every permission');
  });
});
