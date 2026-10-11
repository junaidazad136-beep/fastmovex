import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { formatMoney } from '../notifications/templates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cash-on-delivery rules for a market (Country.codRules). Fake COD orders cost a driver trip and lock stock, so:
 *  - phoneCheck: the mobile number must be proven by an SMS code before paying cash (GUESTS = guest checkout only)
 *  - maxOrderMinor: COD is not offered above this order total (card still works)
 *  - maxOpenOrders: at most this many undelivered COD orders per customer / delivery phone at once
 *  - refusalLimit: after this many refusals at the door, COD is switched off for the customer (staff can switch it back)
 *  - driverCashLimitMinor: a driver holding this much cash must hand it over before picking up more orders
 */
export interface CodRules {
  phoneCheck: 'OFF' | 'GUESTS' | 'ALL';
  maxOrderMinor: string | null;
  maxOpenOrders: number | null;
  refusalLimit: number | null;
  driverCashLimitMinor: string | null;
}

export const DEFAULT_COD_RULES: CodRules = { phoneCheck: 'GUESTS', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 2, driverCashLimitMinor: null };

const MINOR = /^\d{1,15}$/;

/** Validates what staff send from Settings; anything missing keeps its default. Exported for tests. */
export function parseCodRules(input: unknown): CodRules {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: CodRules = { ...DEFAULT_COD_RULES };
  if (v.phoneCheck !== undefined) {
    if (!['OFF', 'GUESTS', 'ALL'].includes(String(v.phoneCheck))) throw new BadRequestException('phoneCheck must be OFF, GUESTS or ALL');
    out.phoneCheck = v.phoneCheck as CodRules['phoneCheck'];
  }
  for (const k of ['maxOrderMinor', 'driverCashLimitMinor'] as const) {
    if (v[k] === undefined) continue;
    if (v[k] === null || v[k] === '') { out[k] = null; continue; }
    const s = String(v[k]);
    if (!MINOR.test(s) || BigInt(s) <= 0n) throw new BadRequestException(`${k} must be a positive amount in minor units, or empty for no limit`);
    out[k] = s;
  }
  for (const [k, max] of [['maxOpenOrders', 50], ['refusalLimit', 20]] as const) {
    if (v[k] === undefined) continue;
    if (v[k] === null || v[k] === '') { out[k] = null; continue; }
    const n = Number(v[k]);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new BadRequestException(`${k} must be between 1 and ${max}, or empty for no limit`);
    out[k] = n;
  }
  return out;
}

/** Reads stored rules leniently (older rows, hand edits): bad values fall back to defaults instead of breaking checkout. */
export function readCodRules(stored: unknown): CodRules {
  try { return parseCodRules(stored); } catch { return { ...DEFAULT_COD_RULES }; }
}

const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY'] as const;

@Injectable()
export class CodGuardService {
  private readonly logger = new Logger(CodGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async rules(countryCode: string): Promise<CodRules> {
    const c = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { codRules: true } });
    return readCodRules(c?.codRules);
  }

  /** Can guests prove their phone right now? (SMS must be connected; otherwise guest COD is closed when a check is required.) */
  smsAvailable() { return !!this.notifications?.channelEnabled('SMS'); }

  /**
   * Checks a COD order before it is placed. Registered customers in "ALL" mode need a verified mobile on the account;
   * guests prove the phone in GuestCheckoutService (they have no account to verify).
   */
  async assertAllowed(p: { userId: string; countryCode: string; currencyCode: string; totalMinor: bigint; phone?: string | null; isGuest: boolean; phoneConfirmed?: boolean }) {
    const rules = await this.rules(p.countryCode);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.userId }, select: { codBlocked: true, phone: true, phoneVerifiedAt: true } });
    const phone = p.phone?.replace(/\s/g, '') || null;

    const blockedByPhone = phone ? await this.prisma.user.count({ where: { phone, codBlocked: true } }) : 0;
    if (user.codBlocked || blockedByPhone) {
      throw new ForbiddenException({ message: 'Cash on delivery is not available for this account. Please pay by card, or contact us.', reason: 'COD_BLOCKED' });
    }
    if (rules.maxOrderMinor && p.totalMinor > BigInt(rules.maxOrderMinor)) {
      throw new BadRequestException({
        message: `Cash on delivery is available for orders up to ${formatMoney(rules.maxOrderMinor, p.currencyCode)}. Please pay by card.`,
        reason: 'COD_LIMIT', maxOrderMinor: rules.maxOrderMinor,
      });
    }
    if (rules.maxOpenOrders) {
      const open = await this.prisma.order.count({
        where: {
          status: { in: [...OPEN_STATUSES] },
          payments: { some: { method: 'COD', status: { in: ['PENDING', 'AUTHORIZED'] } } },
          OR: [{ userId: p.userId }, ...(phone ? [{ shippingAddress: { path: ['phone'], equals: phone } }] : [])],
        },
      });
      if (open >= rules.maxOpenOrders) {
        throw new BadRequestException({
          message: `You already have ${open} cash-on-delivery order(s) on the way. Please wait for them, or pay this one by card.`,
          reason: 'COD_OPEN_ORDERS',
        });
      }
    }
    if (!p.isGuest && !p.phoneConfirmed && rules.phoneCheck === 'ALL' && !(user.phone && user.phoneVerifiedAt)) {
      throw new ForbiddenException({ message: 'Verify your mobile number in your account to pay cash on delivery.', reason: 'COD_PHONE_UNVERIFIED' });
    }
  }

  /**
   * The driver says the customer refused a COD order at the door. Counted once per delivery; at the market's limit,
   * COD is switched off for that customer (and for anyone using the same phone). Staff can switch it back on.
   */
  async recordRefusal(deliveryId: string, actorId: string) {
    const d = await this.prisma.deliveryOrder.findUnique({
      where: { id: deliveryId },
      select: { id: true, events: { where: { note: { startsWith: '[refused]' } }, select: { id: true } }, sellerOrder: { select: { order: { select: { userId: true, countryCode: true, payments: { where: { method: 'COD' }, select: { id: true }, take: 1 } } } } } },
    });
    if (!d || !d.sellerOrder.order.payments.length) return null; // card orders: nothing to block
    if (d.events.length > 1) return null; // this delivery was already counted (the event of this attempt is the first)
    const order = d.sellerOrder.order;
    const user = await this.prisma.user.update({ where: { id: order.userId }, data: { codRefusals: { increment: 1 } }, select: { id: true, codRefusals: true, codBlocked: true } });
    const rules = await this.rules(order.countryCode);
    if (!user.codBlocked && rules.refusalLimit && user.codRefusals >= rules.refusalLimit) {
      const reason = `Refused ${user.codRefusals} cash-on-delivery orders at the door`;
      await this.prisma.user.update({ where: { id: user.id }, data: { codBlocked: true, codBlockedReason: reason } });
      await this.audit.log({ actorId, action: 'customer.cod_blocked', entityType: 'User', entityId: user.id, after: { reason, automatic: true } });
      this.logger.log(`COD switched off for user ${user.id} after ${user.codRefusals} refusals`);
    }
    return user.codRefusals;
  }

  /** Staff switch COD off/on for a customer (users.update). */
  async setBlocked(userId: string, blocked: boolean, reason: string | undefined, actorId: string) {
    if (blocked && (!reason || reason.trim().length < 5)) throw new BadRequestException('Write why cash on delivery is switched off (at least 5 characters)');
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { codBlocked: true, codBlockedReason: true } });
    const data: Prisma.UserUpdateInput = blocked
      ? { codBlocked: true, codBlockedReason: reason!.trim() }
      : { codBlocked: false, codBlockedReason: null, codRefusals: 0 }; // a fresh start: refusals are counted again from zero
    const after = await this.prisma.user.update({ where: { id: userId }, data, select: { id: true, codBlocked: true, codBlockedReason: true, codRefusals: true } });
    await this.audit.log({ actorId, action: blocked ? 'customer.cod_blocked' : 'customer.cod_unblocked', entityType: 'User', entityId: userId, before, after: { codBlocked: after.codBlocked, reason: after.codBlockedReason } });
    return after;
  }
}
