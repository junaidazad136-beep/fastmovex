import { ConflictException, Controller, Get, Headers, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Matches } from 'class-validator';
import { tzFor } from '../analytics/range';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { CountryModule, CountryService } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildSlotDays, localToUtc, readSlotConfig, resolveSlot, SlotConfig } from './slots';

type Tx = Prisma.TransactionClient;

@Injectable()
export class DeliverySlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async config(countryCode: string): Promise<SlotConfig> {
    const c = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { deliverySlots: true } });
    return readSlotConfig(c?.deliverySlots);
  }

  /** What the checkout shows: open days and windows with what is left. Live (not cached): it changes with every order. */
  async options(countryCode: string, now = new Date()) {
    const cfg = await this.config(countryCode);
    const { tz, offsetMin } = tzFor(countryCode);
    if (!cfg.enabled) return { enabled: false, required: false, timezone: tz, days: [] };
    const until = new Date(now.getTime() + (cfg.daysAhead + 1) * 86_400_000);
    const rows = await this.prisma.deliverySlotUsage.findMany({ where: { countryCode, slotStart: { gte: now, lt: until } }, select: { slotStart: true, booked: true } });
    const booked = new Map(rows.map((r) => [r.slotStart.toISOString(), r.booked]));
    return { enabled: true, required: cfg.required, timezone: tz, days: buildSlotDays(cfg, offsetMin, now, booked) };
  }

  /**
   * Inside the checkout transaction: checks the chosen window and takes one place in it.
   * The increment only happens while there is room (booked < capacity), so two customers can never take the last place.
   * Returns null when no window was chosen and none is required.
   */
  async book(tx: Tx, countryCode: string, startIso: string | undefined, now = new Date()): Promise<{ start: Date; end: Date } | null> {
    const c = await tx.country.findUnique({ where: { code: countryCode }, select: { deliverySlots: true } });
    const cfg = readSlotConfig(c?.deliverySlots);
    if (!cfg.enabled) return null; // slots switched off: any stale choice from an open tab is simply ignored
    if (!startIso) {
      if (cfg.required) throw new ConflictException({ message: 'Choose a delivery time', reason: 'SLOT_REQUIRED' });
      return null;
    }
    const slot = resolveSlot(cfg, tzFor(countryCode).offsetMin, now, startIso);
    await tx.$executeRaw`
      INSERT INTO "DeliverySlotUsage" ("countryCode", "slotStart", "booked", "updatedAt") VALUES (${countryCode}, ${slot.start}, 0, now())
      ON CONFLICT ("countryCode", "slotStart") DO NOTHING`;
    const took = await tx.$executeRaw`
      UPDATE "DeliverySlotUsage" SET "booked" = "booked" + 1, "updatedAt" = now()
       WHERE "countryCode" = ${countryCode} AND "slotStart" = ${slot.start} AND "booked" < ${slot.capacity}`;
    if (took !== 1) throw new ConflictException({ message: 'This delivery time just filled up. Please choose another one.', reason: 'SLOT_FULL' });
    return { start: slot.start, end: slot.end };
  }

  /** Gives back a place in a window (the order moved to another window). Never goes below zero. */
  async release(tx: Tx, countryCode: string, start: Date | null | undefined) {
    if (!start) return;
    await tx.$executeRaw`
      UPDATE "DeliverySlotUsage" SET "booked" = GREATEST(0, "booked" - 1), "updatedAt" = now()
       WHERE "countryCode" = ${countryCode} AND "slotStart" = ${start}`;
  }

  /** Staff view of one day: every window with its bookings and the orders in it. */
  async day(countryCode: string, date: string) {
    const cfg = await this.config(countryCode);
    const { offsetMin, tz } = tzFor(countryCode);
    const from = localToUtc(date, '00:00', offsetMin);
    const to = new Date(from.getTime() + 86_400_000);
    const orders = await this.prisma.order.findMany({
      where: { countryCode, deliverySlotStart: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
      select: { orderNumber: true, status: true, deliverySlotStart: true, deliverySlotEnd: true, totalMinor: true, currencyCode: true, shippingAddress: true },
      orderBy: [{ deliverySlotStart: 'asc' }, { placedAt: 'asc' }],
      take: 2000,
    });
    const windows = cfg.windows.map((w) => {
      const start = localToUtc(date, w.start, offsetMin).toISOString();
      const inWindow = orders.filter((o) => o.deliverySlotStart?.toISOString() === start);
      return { from: w.start, to: w.end, start, capacity: w.capacity, booked: inWindow.length };
    });
    return {
      date, timezone: tz, enabled: cfg.enabled, windows,
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber, status: o.status, slotStart: o.deliverySlotStart, slotEnd: o.deliverySlotEnd,
        totalMinor: o.totalMinor.toString(), currencyCode: o.currencyCode,
        area: [(o.shippingAddress as { zone?: string; city?: string } | null)?.zone, (o.shippingAddress as { city?: string } | null)?.city].filter(Boolean).join(', '),
      })),
    };
  }
}

class DayQuery {
  @ApiProperty({ example: '2026-10-02' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
}

@ApiTags('Checkout')
@Controller({ path: 'delivery', version: '1' })
export class DeliverySlotsController {
  constructor(private readonly slots: DeliverySlotsService, private readonly countries: CountryService) {}

  /** Delivery windows the customer can pick at checkout (market from X-Country). */
  @Public() @Get('slots') @ApiHeader({ name: 'X-Country', required: false })
  async options(@Headers('x-country') c?: string) {
    return this.slots.options((await this.countries.resolve(c)).code);
  }
}

@ApiTags('Admin / Orders') @ApiBearerAuth()
@Controller({ path: 'admin/delivery-slots', version: '1' })
export class AdminDeliverySlotsController {
  constructor(private readonly slots: DeliverySlotsService, private readonly countries: CountryService) {}

  @RequirePermissions('orders.read') @Get()
  async day(@Query() q: DayQuery, @Headers('x-country') c?: string) {
    return this.slots.day((await this.countries.resolve(c)).code, q.date);
  }
}

@Module({ imports: [CountryModule], controllers: [DeliverySlotsController, AdminDeliverySlotsController], providers: [DeliverySlotsService], exports: [DeliverySlotsService] })
export class SlotsModule {}
