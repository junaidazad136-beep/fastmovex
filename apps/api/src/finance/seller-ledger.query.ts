import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Read-side helpers that derive per-shipment money FROM THE LEDGER (never from editable columns). */
@Injectable()
export class SellerLedgerQuery {
  constructor(private readonly prisma: PrismaService) {}

  /** What was credited to this seller when the order was captured (net earnings + any FastMoveX promo reimbursement). */
  async capturedForSeller(orderId: string, sellerId: string, currencyCode: string, db: Db = this.prisma): Promise<bigint | null> {
    const tx = await db.ledgerTransaction.findUnique({ where: { idempotencyKey: `order_captured_${orderId}` }, select: { id: true } });
    if (!tx) return null; // not captured (e.g. COD not yet delivered)
    const agg = await db.ledgerEntry.aggregate({
      where: { transactionId: tx.id, account: { type: 'SELLER_PENDING', sellerId, currencyCode } },
      _sum: { amountMinor: true },
    });
    return agg._sum.amountMinor ?? 0n;
  }

  /** Everything already taken back from this shipment by refunds (a positive number). */
  async refundedFromSeller(sellerOrderId: string, sellerId: string, db: Db = this.prisma): Promise<bigint> {
    const refunds = await db.refund.findMany({ where: { sellerOrderId, status: 'SUCCEEDED' }, select: { id: true } });
    if (!refunds.length) return 0n;
    const agg = await db.ledgerEntry.aggregate({
      where: {
        transaction: { refType: 'Refund', refId: { in: refunds.map((r) => r.id) } },
        account: { type: { in: ['SELLER_PENDING', 'SELLER_AVAILABLE'] }, sellerId },
      },
      _sum: { amountMinor: true },
    });
    return -(agg._sum.amountMinor ?? 0n);
  }
}
