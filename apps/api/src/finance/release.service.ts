import { Injectable, Logger, Optional } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SellerLedgerQuery } from './seller-ledger.query';

const BATCH = 200;

/**
 * Moves seller earnings from PENDING to AVAILABLE once the return window has passed.
 * Safe to run from several servers at once: a Postgres advisory lock lets one instance work,
 * and every release has an idempotency key, so a shipment can never be released twice.
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly query: SellerLedgerQuery,
    @Optional() private readonly audit?: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduled() {
    try {
      const r = await this.releaseDue(new Date());
      if (r.released) this.logger.log(`Released ${r.released} shipments`);
    } catch (e) {
      this.logger.error(`Release job failed: ${(e as Error).message}`);
    }
  }

  /** Run by hand from the finance page (audited) or by the hourly job. */
  async releaseNow(actorId: string) {
    const r = await this.releaseDue(new Date());
    await this.audit?.log({ actorId, action: 'finance.release_run', entityType: 'SellerOrder', entityId: 'batch', after: r });
    return r;
  }

  async releaseDue(now: Date): Promise<{ released: number; skipped: number }> {
    const candidates = await this.prisma.sellerOrder.findMany({
      where: {
        status: 'DELIVERED',
        releasedAt: null,
        deliveredAt: { not: null },
        // no open return on any item of this shipment
        items: { none: { returns: { some: { status: { in: ['REQUESTED', 'APPROVED', 'RECEIVED'] } } } } },
      },
      select: {
        id: true, orderId: true, sellerId: true, deliveredAt: true,
        seller: { select: { returnWindowDays: true } },
        order: { select: { currencyCode: true } },
        items: { select: { variant: { select: { product: { select: { returnPolicyDays: true } } } } } },
      },
      orderBy: { deliveredAt: 'asc' },
      take: BATCH,
    });

    let released = 0;
    let skipped = 0;
    for (const so of candidates) {
      // The longest return window of any product in the shipment decides
      const days = Math.max(so.seller.returnWindowDays, ...so.items.map((i) => i.variant.product.returnPolicyDays ?? 0));
      if (so.deliveredAt!.getTime() + days * 86_400_000 > now.getTime()) { skipped++; continue; }

      const done = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'release:' + so.id}))`;
        const fresh = await tx.sellerOrder.findUnique({ where: { id: so.id }, select: { releasedAt: true } });
        if (fresh?.releasedAt) return false;

        const captured = await this.query.capturedForSeller(so.orderId, so.sellerId, so.order.currencyCode, tx);
        if (captured === null) return false; // payment not captured yet (COD in transit etc.)
        const refunded = await this.query.refundedFromSeller(so.id, so.sellerId, tx);
        const amount = captured - refunded;

        if (amount > 0n) {
          await this.ledger.post(
            {
              type: 'SELLER_RELEASE', refType: 'SellerOrder', refId: so.id, idempotencyKey: `release_${so.id}`,
              currencyCode: so.order.currencyCode, description: 'Return window closed',
              entries: [
                { type: 'SELLER_PENDING', sellerId: so.sellerId, amountMinor: -amount },
                { type: 'SELLER_AVAILABLE', sellerId: so.sellerId, amountMinor: amount },
              ],
            },
            tx,
          );
        }
        await tx.sellerOrder.update({ where: { id: so.id }, data: { releasedAt: now } });
        return true;
      });
      if (done) released++; else skipped++;
    }
    return { released, skipped };
  }
}
