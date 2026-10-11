import { BadRequestException, Controller, Get, Injectable, Logger, Module, Optional, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { tzFor } from '../analytics/range';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** Abandoned-cart reminders for one market. Stored as Country.cartReminders. */
export interface ReminderConfig {
  enabled: boolean;
  /** first reminder this long after the cart was last changed */
  firstAfterMinutes: number;
  /** a second reminder this long after the first; null = only one */
  secondAfterHours: number | null;
  /** no messages between these local hours (e.g. 21 → 9) */
  quietFrom: number;
  quietTo: number;
}

export const REMINDERS_OFF: ReminderConfig = { enabled: false, firstAfterMinutes: 60, secondAfterHours: 24, quietFrom: 21, quietTo: 9 };
/** Carts older than this are not chased any more. */
const MAX_AGE_DAYS = 7;
/** A reminder counts as the reason for an order placed within this many days. */
export const ATTRIBUTION_DAYS = 7;

export function parseReminderConfig(raw: unknown): ReminderConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bad = (m: string): never => { throw new BadRequestException(`Cart reminders: ${m}`); };
  const int = (v: unknown, d: number) => (v === undefined ? d : Number(v));
  const firstAfterMinutes = int(c.firstAfterMinutes, 60);
  if (!Number.isInteger(firstAfterMinutes) || firstAfterMinutes < 30 || firstAfterMinutes > 2880) bad('first reminder after 30 minutes to 2 days');
  const secondAfterHours = c.secondAfterHours === null ? null : int(c.secondAfterHours, 24);
  if (secondAfterHours !== null && (!Number.isInteger(secondAfterHours) || secondAfterHours < 12 || secondAfterHours > 168)) bad('second reminder after 12 hours to 7 days, or none');
  const quietFrom = int(c.quietFrom, 21);
  const quietTo = int(c.quietTo, 9);
  if (![quietFrom, quietTo].every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) bad('quiet hours must be 0–23');
  return { enabled: c.enabled === true, firstAfterMinutes, secondAfterHours, quietFrom, quietTo };
}

export function readReminderConfig(raw: unknown): ReminderConfig {
  try { return parseReminderConfig(raw); } catch { return REMINDERS_OFF; }
}

/** True during the market's quiet hours (wraps past midnight, e.g. 21:00–09:00). */
export function isQuiet(cfg: ReminderConfig, now: Date, offsetMin: number): boolean {
  if (cfg.quietFrom === cfg.quietTo) return false;
  const h = new Date(now.getTime() + offsetMin * 60_000).getUTCHours();
  return cfg.quietFrom < cfg.quietTo ? h >= cfg.quietFrom && h < cfg.quietTo : h >= cfg.quietFrom || h < cfg.quietTo;
}

/** '"Khalas Dates 1kg" and 2 more items' in the customer's language. */
export function describeItems(titles: string[], locale: string): string {
  const first = `"${titles[0] ?? ''}"`;
  const more = titles.length - 1;
  if (more <= 0) return first;
  if (locale === 'ar') return `${first} و${more === 1 ? 'منتج آخر' : more === 2 ? 'منتجين آخرين' : `${more} منتجات أخرى`}`;
  return `${first} and ${more} more item${more === 1 ? '' : 's'}`;
}

@Injectable()
export class CartRemindersService {
  private readonly logger = new Logger(CartRemindersService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Every 5 minutes: carts with items, untouched for a while, of customers who agreed to promotions.
   * Each reminder is claimed with a conditional update first, so several API instances never send it twice.
   */
  @Interval(5 * 60_000)
  async run(now = new Date()): Promise<number> {
    if (this.running || !this.notifications || process.env.NODE_ENV === 'test') return 0;
    return this.runOnce(now);
  }

  async runOnce(now = new Date()): Promise<number> {
    if (this.running || !this.notifications) return 0;
    this.running = true;
    let sent = 0;
    try {
      const markets = await this.prisma.country.findMany({ where: { isActive: true }, select: { code: true, cartReminders: true } });
      for (const m of markets) {
        const cfg = readReminderConfig(m.cartReminders);
        if (!cfg.enabled || isQuiet(cfg, now, tzFor(m.code).offsetMin)) continue;
        sent += await this.remindMarket(m.code, cfg, now);
      }
    } catch (e) {
      this.logger.error(`cart reminders failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return sent;
  }

  private async remindMarket(countryCode: string, cfg: ReminderConfig, now: Date): Promise<number> {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const dueFirst = { remindersSent: 0, itemsChangedAt: { lte: ago(cfg.firstAfterMinutes * 60_000) } };
    const dueSecond = cfg.secondAfterHours ? { remindersSent: 1, lastReminderAt: { lte: ago(cfg.secondAfterHours * 3_600_000) } } : null;
    const carts = await this.prisma.cart.findMany({
      where: {
        countryCode,
        userId: { not: null },
        items: { some: {} },
        itemsChangedAt: { gte: ago(MAX_AGE_DAYS * 86_400_000) },
        // never more than one reminder a day, whatever the settings
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: ago(20 * 3_600_000) } }],
        AND: [{ OR: dueSecond ? [dueFirst, dueSecond] : [dueFirst] }],
        user: { status: 'ACTIVE', isGuest: false, marketingOptIn: true, deletedAt: null },
      },
      select: {
        id: true, userId: true, remindersSent: true,
        user: { select: { locale: true } },
        items: { orderBy: { addedAt: 'desc' }, take: 5, select: { variant: { select: { product: { select: { title: true, titleAr: true } } } } } },
        _count: { select: { items: true } },
      },
      orderBy: { itemsChangedAt: 'asc' },
      take: 200,
    });
    const site = this.config.get('STOREFRONT_URL', { infer: true })?.replace(/\/$/, '');
    let sent = 0;
    for (const c of carts) {
      const claimed = await this.prisma.cart.updateMany({ where: { id: c.id, remindersSent: c.remindersSent }, data: { remindersSent: { increment: 1 }, lastReminderAt: now } });
      if (claimed.count !== 1) continue; // another instance took it, or the customer just changed the cart
      const locale = c.user?.locale === 'ar' ? 'ar' : 'en';
      const titles = c.items.map((i) => (locale === 'ar' ? i.variant.product.titleAr || i.variant.product.title : i.variant.product.title));
      while (titles.length < c._count.items) titles.push('');
      const link = site ? `${site}/${locale}/cart` : (locale === 'ar' ? 'موقع فاست موف إكس' : 'the FastMoveX website');
      await this.notifications!.notify(c.userId!, 'CART_REMINDER', { items: describeItems(titles, locale), link }, { link: `/${locale}/cart`, reminder: c.remindersSent + 1 });
      sent++;
    }
    if (sent) this.logger.log(`${countryCode}: ${sent} cart reminder(s) sent`);
    return sent;
  }

  /** What reminders brought in: reminders sent, orders placed after one, and their value. */
  async stats(days: number, now = new Date()) {
    const from = new Date(now.getTime() - days * 86_400_000);
    const [reminders, recovered] = await Promise.all([
      this.prisma.notification.count({ where: { type: 'CART_REMINDER', channel: 'IN_APP', createdAt: { gte: from } } }),
      this.prisma.order.aggregate({
        where: { cartReminderAt: { not: null }, placedAt: { gte: from }, status: { notIn: ['CANCELLED', 'PENDING'] } },
        _count: { _all: true }, _sum: { totalMinor: true },
      }),
    ]);
    return {
      days, reminders,
      recoveredOrders: recovered._count._all,
      recoveredMinor: (recovered._sum.totalMinor ?? 0n).toString(),
      conversionPercent: reminders ? Math.round((recovered._count._all / reminders) * 1000) / 10 : 0,
    };
  }
}

class StatsQuery {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

@ApiTags('Admin / Marketing') @ApiBearerAuth()
@Controller({ path: 'admin/cart-reminders', version: '1' })
export class CartRemindersController {
  constructor(private readonly svc: CartRemindersService) {}

  @RequirePermissions('analytics.read') @Get('stats')
  stats(@Query() q: StatsQuery) {
    return this.svc.stats(q.days ?? 30);
  }
}

@Module({ controllers: [CartRemindersController], providers: [CartRemindersService], exports: [CartRemindersService] })
export class CartRemindersModule {}
