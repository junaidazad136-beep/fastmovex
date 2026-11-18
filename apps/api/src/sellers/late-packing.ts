import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { EVENTS } from '../notifications/notification.events';
import { PrismaService } from '../prisma/prisma.service';

/** Seller policy §5: ready for pickup within 24 hours of the order (48 hours for orders placed on a Friday in Qatar). */
export const PACK_HOURS = 24;
export const PACK_HOURS_FRIDAY = 48;

/** Hours the seller has to pack an order placed at `createdAt` (Qatar time decides the Friday). Exported for tests. */
export function packHoursFor(createdAt: Date): number {
  const qatar = new Date(createdAt.getTime() + 3 * 3_600_000); // Asia/Qatar is UTC+3 all year
  return qatar.getUTCDay() === 5 ? PACK_HOURS_FRIDAY : PACK_HOURS;
}

/**
 * Every hour: shipments still not ready after the packing time get one warning to the seller (email + in-app).
 * Account Health counts them; staff decide on hiding products for repeat cases (policy §10).
 */
@Injectable()
export class LatePackingService {
  private readonly logger = new Logger(LatePackingService.name);
  constructor(private readonly prisma: PrismaService, @Optional() private readonly events?: EventEmitter2) {}

  @Cron('20 * * * *', { name: 'late-packing' })
  async run(now = new Date()) {
    const oldest = new Date(now.getTime() - PACK_HOURS * 3_600_000);
    const candidates = await this.prisma.sellerOrder.findMany({
      where: { status: { in: ['CONFIRMED', 'PREPARING'] }, lateWarnedAt: null, createdAt: { lte: oldest }, seller: { isHouse: false } },
      select: { id: true, createdAt: true },
      take: 500,
    });
    let warned = 0;
    for (const so of candidates) {
      const hours = packHoursFor(so.createdAt);
      if (now.getTime() - so.createdAt.getTime() < hours * 3_600_000) continue;
      // claim it once even if two servers run the job at the same time
      const claimed = await this.prisma.sellerOrder.updateMany({ where: { id: so.id, lateWarnedAt: null }, data: { lateWarnedAt: now } });
      if (claimed.count !== 1) continue;
      this.events?.emit(EVENTS.SELLER_LATE_PACKING, { id: so.id, hours });
      warned++;
    }
    if (warned) this.logger.log(`late packing: ${warned} seller(s) warned`);
    return { warned };
  }
}
