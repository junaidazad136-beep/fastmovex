import { Body, Controller, Get, Injectable, Logger, Module, Optional, Patch } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsObject } from 'class-validator';
import { tzFor } from '../analytics/range';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { FAR_FROM_ADDRESS_M } from '../delivery/delivery-rules';
import { slotLabel } from '../delivery/slots';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';
import { EVENTS, IdEvent, OrderEvent, ShipmentStatusEvent } from './notification.events';
import { NotificationsService } from './notifications.service';
import { formatMoney, STAFF_ALERTS, StaffAlertType } from './templates';

export type AlertMode = 'off' | 'app' | 'email';
const MODES: AlertMode[] = ['off', 'app', 'email'];

/** Who gets each alert: everyone whose roles carry the permission. Labels are for the preferences screen. */
export const STAFF_ALERT_RULES: Record<StaffAlertType, { permission: string; label: string; hint: string }> = {
  STAFF_NEW_ORDER: { permission: 'orders.update', label: 'New order', hint: 'A paid or cash-on-delivery order for our own store comes in' },
  STAFF_DELIVERY_FAILED: { permission: 'delivery.manage', label: 'Delivery failed', hint: 'A driver could not deliver or the customer refused' },
  STAFF_REFUND_PENDING: { permission: 'refunds.approve', label: 'Refund to approve', hint: 'A refund is waiting for approval' },
  STAFF_LOW_STOCK: { permission: 'inventory.manage', label: 'Low stock', hint: 'Products of our own store fall to their alert level' },
  STAFF_STOCKTAKE_SUBMITTED: { permission: 'inventory.approve', label: 'Stocktake to approve', hint: 'A counted stocktake is submitted' },
  STAFF_CASH_SHORT: { permission: 'cash.receive', label: 'Cash short', hint: 'A driver hands over less cash than collected' },
};

/** The mode a staff member chose for an alert ("app" unless they changed it). Exported for tests. */
export function alertMode(prefs: unknown, type: StaffAlertType): AlertMode {
  const v = prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>)[type] : undefined;
  return MODES.includes(v as AlertMode) ? (v as AlertMode) : 'app';
}

/** Keeps known alert types and modes only. Exported for tests. */
export function cleanPrefs(input: Record<string, unknown>): Partial<Record<StaffAlertType, AlertMode>> {
  const out: Partial<Record<StaffAlertType, AlertMode>> = {};
  for (const t of STAFF_ALERTS) if (MODES.includes(input[t] as AlertMode)) out[t] = input[t] as AlertMode;
  return out;
}

class PrefsDto {
  @ApiProperty({ example: { STAFF_NEW_ORDER: 'email', STAFF_LOW_STOCK: 'off' }, description: 'off | app | email per alert' })
  @IsObject() prefs: Record<string, unknown>;
}

const country = () => process.env.DEFAULT_COUNTRY ?? 'QA';

/**
 * Staff alerts: the admin bell (in-app notifications) and, for those who chose it, an email. Recipients are found by
 * permission at the moment of the alert, so a role change takes effect at once. Nobody is alerted about their own action.
 */
@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger(StaffAlertsService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService, private readonly warehouses: WarehousesService, @Optional() private readonly audit?: AuditService) {}

  /** Active staff whose roles include the permission. */
  recipients(permission: string) {
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE', deletedAt: null,
        roles: { some: { role: { permissions: { some: { permission: { code: permission } } } } } },
      },
      select: { id: true, alertPrefs: true },
    });
  }

  /** Sends one alert to everyone who should get it; returns how many were alerted. */
  async send(type: StaffAlertType, vars: Record<string, string | number | null | undefined>, link: string, exceptUserId?: string | null) {
    const staff = await this.recipients(STAFF_ALERT_RULES[type].permission);
    const base = process.env.ADMIN_URL?.replace(/\/$/, '');
    let n = 0;
    for (const s of staff) {
      if (s.id === exceptUserId) continue;
      const mode = alertMode(s.alertPrefs, type);
      if (mode === 'off') continue;
      await this.notifications.notify(s.id, type, vars, { link, staff: true }, { email: mode === 'email', emailFooter: base ? `Open: ${base}${link}` : undefined });
      n++;
    }
    return n;
  }

  private safe(what: string, fn: () => Promise<unknown>) {
    return fn().catch((e: Error) => this.logger.warn(`staff alert ${what} failed: ${e.message}`));
  }

  // ------------------------------------------------------------------ events

  @OnEvent(EVENTS.ORDER_CONFIRMED, { async: true })
  onOrder(e: OrderEvent) {
    return this.safe('new order', async () => {
      const o = await this.prisma.order.findUniqueOrThrow({
        where: { id: e.orderId },
        select: {
          orderNumber: true, totalMinor: true, currencyCode: true, countryCode: true, deliverySlotStart: true, deliverySlotEnd: true,
          user: { select: { fullName: true, tags: true } },
          sellerOrders: { select: { sellerId: true, _count: { select: { items: true } } } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } },
        },
      });
      // our own store's part only: marketplace sellers get their own "new order" notice and ship it themselves
      const house = await this.warehouses.house();
      const ours = o.sellerOrders.filter((so) => so.sellerId === house);
      if (!ours.length) return;
      const method = o.payments[0]?.method;
      const slot = o.deliverySlotStart && o.deliverySlotEnd ? slotLabel(o.deliverySlotStart, o.deliverySlotEnd, tzFor(o.countryCode).tz, 'en') : null;
      const tags = o.user.tags.length ? ` [${o.user.tags.join(', ')}]` : '';
      await this.send('STAFF_NEW_ORDER', {
        orderNumber: o.orderNumber, customer: `${o.user.fullName}${tags}`, items: ours.reduce((n, so) => n + so._count.items, 0), total: formatMoney(o.totalMinor, o.currencyCode),
        payment: method === 'COD' ? 'Cash on delivery' : 'Paid', slotLine: slot ? ` · ${slot}` : '',
      }, `/orders/${o.orderNumber}`);
    });
  }

  @OnEvent(EVENTS.DELIVERY_FAILED, { async: true })
  onDeliveryFailed(e: IdEvent) {
    return this.safe('delivery failed', async () => {
      const d = await this.prisma.deliveryOrder.findUniqueOrThrow({
        where: { id: e.id },
        select: { courierUserId: true, failureDistanceM: true, sellerOrder: { select: { order: { select: { orderNumber: true } } } } },
      });
      const courier = d.courierUserId ? await this.prisma.user.findUnique({ where: { id: d.courierUserId }, select: { fullName: true } }) : null;
      const far = d.failureDistanceM != null && d.failureDistanceM > FAR_FROM_ADDRESS_M ? ` · marked ${Math.round(d.failureDistanceM)} m from the address` : '';
      await this.send('STAFF_DELIVERY_FAILED', {
        orderNumber: d.sellerOrder.order.orderNumber, driver: courier?.fullName ?? 'Driver', reason: e.reason ?? 'not delivered', farLine: far,
      }, `/orders/${d.sellerOrder.order.orderNumber}`, d.courierUserId);
    });
  }

  @OnEvent(EVENTS.REFUND_REQUESTED, { async: true })
  onRefund(e: IdEvent) {
    return this.safe('refund pending', () => this.refundAlert(e.id));
  }

  /** A cancelled paid shipment asks for a refund inside the cancel transaction; the event after it commits finds it. */
  @OnEvent(EVENTS.SHIPMENT_STATUS, { async: true })
  onShipment(e: ShipmentStatusEvent) {
    if (e.status !== 'CANCELLED') return;
    return this.safe('refund pending (cancel)', async () => {
      const rows = await this.prisma.refund.findMany({ where: { sellerOrderId: e.sellerOrderId, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 5 * 60_000) } }, select: { id: true } });
      for (const r of rows) await this.refundAlert(r.id);
    });
  }

  private async refundAlert(id: string) {
    const r = await this.prisma.refund.findUniqueOrThrow({
      where: { id }, select: { status: true, amountMinor: true, reason: true, createdById: true, order: { select: { orderNumber: true, currencyCode: true } } },
    });
    if (r.status !== 'PENDING') return;
    await this.send('STAFF_REFUND_PENDING', {
      amount: formatMoney(r.amountMinor, r.order.currencyCode), orderNumber: r.order.orderNumber, reason: (r.reason ?? '').slice(0, 120),
    }, '/refunds', r.createdById); // the person who asked cannot approve their own refund anyway
  }

  @OnEvent(EVENTS.STOCKTAKE_SUBMITTED, { async: true })
  onStocktake(e: IdEvent) {
    return this.safe('stocktake', async () => {
      const c = await this.prisma.stockCount.findUniqueOrThrow({
        where: { id: e.id },
        select: { id: true, number: true, submittedById: true, warehouse: { select: { name: true } }, lines: { select: { expectedQty: true, countedQty: true } } },
      });
      const by = c.submittedById ? await this.prisma.user.findUnique({ where: { id: c.submittedById }, select: { fullName: true } }) : null;
      const counted = c.lines.filter((l) => l.countedQty !== null);
      await this.send('STAFF_STOCKTAKE_SUBMITTED', {
        number: c.number, warehouse: c.warehouse.name, lines: counted.length, diffs: counted.filter((l) => l.countedQty !== l.expectedQty).length, by: by?.fullName ?? '—',
      }, `/stock-counts/${c.id}`, c.submittedById);
    });
  }

  @OnEvent(EVENTS.CASH_SHORT, { async: true })
  onCashShort(e: IdEvent) {
    return this.safe('cash short', async () => {
      const h = await this.prisma.cashHandover.findUniqueOrThrow({
        where: { id: e.id },
        select: { number: true, expectedMinor: true, receivedMinor: true, varianceMinor: true, currencyCode: true, note: true, receivedById: true, holder: { select: { fullName: true } } },
      });
      const m = (v: bigint) => formatMoney(v, h.currencyCode);
      await this.send('STAFF_CASH_SHORT', {
        amount: m(-h.varianceMinor), driver: h.holder.fullName, received: m(h.receivedMinor), expected: m(h.expectedMinor), number: h.number,
        noteLine: h.note ? ` — “${h.note.slice(0, 120)}”` : '',
      }, '/cash', h.receivedById);
    });
  }

  // ------------------------------------------------------------------ low stock

  /**
   * Every 15 minutes: products of our own store whose sellable stock fell to their alert level are announced once, in
   * one alert. A product is announced again only after it was restocked above the level and fell again.
   */
  @Cron('*/15 * * * *')
  scheduledLowStock() {
    return this.safe('low stock', () => this.scanLowStock());
  }

  async scanLowStock() {
    const house = await this.warehouses.house();
    // restocked above the level: may be announced again next time
    await this.prisma.$executeRaw`
      UPDATE "Inventory" SET "lowStockAlertedAt" = NULL WHERE "lowStockAlertedAt" IS NOT NULL AND "onHand" - reserved > "lowStockThreshold"`;
    const low = await this.prisma.$queryRaw<{ id: string; title: string; sku: string; available: number }[]>(Prisma.sql`
      SELECT i.id, p.title, v.sku, (i."onHand" - i.reserved)::int AS available
      FROM "Inventory" i JOIN "ProductVariant" v ON v.id = i."variantId" JOIN "Product" p ON p.id = v."productId" JOIN "Store" s ON s.id = p."storeId"
      WHERE i."lowStockAlertedAt" IS NULL AND i."onHand" - i.reserved <= i."lowStockThreshold"
        AND v."isActive" AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL AND s."sellerId" = ${house}::uuid
      ORDER BY available, p.title LIMIT 200`);
    if (!low.length) return { alerted: 0 };
    await this.prisma.inventory.updateMany({ where: { id: { in: low.map((l) => l.id) } }, data: { lowStockAlertedAt: new Date() } });
    const shown = low.slice(0, 5).map((l) => `${l.title} (${l.sku}) — ${l.available <= 0 ? 'sold out' : `${l.available} left`}`);
    const list = shown.join('; ') + (low.length > 5 ? `; and ${low.length - 5} more` : '');
    await this.send('STAFF_LOW_STOCK', { count: low.length, list }, '/inventory?store=house&stock=low');
    return { alerted: low.length };
  }

  // ------------------------------------------------------------------ preferences

  async prefs(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { alertPrefs: true } });
    return {
      emailAvailable: this.notifications.channelEnabled('EMAIL'),
      alerts: STAFF_ALERTS.filter((t) => user.permissions.includes(STAFF_ALERT_RULES[t].permission)).map((t) => ({
        type: t, label: STAFF_ALERT_RULES[t].label, hint: STAFF_ALERT_RULES[t].hint, mode: alertMode(u.alertPrefs, t),
      })),
    };
  }

  async setPrefs(user: AuthUser, input: Record<string, unknown>) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { alertPrefs: true } });
    const merged = { ...cleanPrefs((u.alertPrefs ?? {}) as Record<string, unknown>), ...cleanPrefs(input) };
    await this.prisma.user.update({ where: { id: user.id }, data: { alertPrefs: merged } });
    await this.audit?.log({ actorId: user.id, action: 'staff.alert_prefs', entityType: 'User', entityId: user.id, after: merged });
    return this.prefs(user);
  }
}

@ApiTags('Account / Notifications') @ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class StaffAlertsController {
  constructor(private readonly svc: StaffAlertsService) {}
  /** The staff alerts this person can receive (by their permissions) and how: off, in the admin bell, or bell + email. */
  @Get('alert-prefs') get(@CurrentUser() u: AuthUser) { return this.svc.prefs(u); }
  @Patch('alert-prefs') set(@CurrentUser() u: AuthUser, @Body() d: PrefsDto) { return this.svc.setPrefs(u, d.prefs); }
}

@Module({ controllers: [StaffAlertsController], providers: [StaffAlertsService], exports: [StaffAlertsService] })
export class StaffAlertsModule {}
