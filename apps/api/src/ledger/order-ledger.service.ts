import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allocate, sum } from '../pricing/money-math';
import { PrismaService } from '../prisma/prisma.service';
import { EntryInput, LedgerService } from './ledger.service';

export interface CaptureInput {
  totalMinor: bigint;
  taxMinor: bigint;
  taxInclusive: boolean;
  platformFundedDiscountMinor: bigint;
  sellers: { sellerId: string; sellerNetMinor: bigint; commissionMinor: bigint; discountMinor: bigint }[];
}

/**
 * Turns a captured order into balanced ledger entries (exported pure so the maths is testable):
 *   cash in            -> CUSTOMER_CLEARING (debit)
 *   seller earnings    -> SELLER_PENDING    (released to SELLER_AVAILABLE after the return window)
 *   FastMoveX commission   -> PLATFORM_REVENUE
 *   VAT added on top   -> TAX_PAYABLE
 *   FastMoveX-funded promo -> PLATFORM_DISCOUNT (expense) and reimbursed to the sellers who gave it
 */
export function buildCaptureEntries(i: CaptureInput): EntryInput[] {
  const reimbursements = allocate(i.platformFundedDiscountMinor, i.sellers.map((s) => s.discountMinor));
  const entries: EntryInput[] = [{ type: 'CUSTOMER_CLEARING', amountMinor: -i.totalMinor }];
  i.sellers.forEach((s, idx) => entries.push({ type: 'SELLER_PENDING', sellerId: s.sellerId, amountMinor: s.sellerNetMinor + reimbursements[idx] }));
  entries.push({ type: 'PLATFORM_REVENUE', amountMinor: sum(i.sellers.map((s) => s.commissionMinor)) });
  if (!i.taxInclusive) entries.push({ type: 'TAX_PAYABLE', amountMinor: i.taxMinor });
  entries.push({ type: 'PLATFORM_DISCOUNT', amountMinor: -i.platformFundedDiscountMinor });
  return entries.filter((e) => e.amountMinor !== 0n);
}

@Injectable()
export class OrderLedgerService {
  private readonly logger = new Logger(OrderLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Idempotent: called from the payment webhook, from COD delivery and from checkout — posts at most once per order.
   * Only live (not cancelled) shipments are captured, so a COD order where one seller cancelled still balances.
   * Returns the amount captured.
   */
  async postCapture(orderId: string, tx?: Prisma.TransactionClient): Promise<bigint | null> {
    const db = tx ?? this.prisma;
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, orderNumber: true, currencyCode: true, countryCode: true,
        coupon: { select: { fundedBy: true } },
        sellerOrders: {
          select: { sellerId: true, sellerNetMinor: true, commissionMinor: true, subtotalMinor: true, discountMinor: true, deliveryFeeMinor: true, taxMinor: true, status: true },
        },
      },
    });
    if (!order) return null;
    const country = await db.country.findUnique({ where: { code: order.countryCode }, select: { pricesIncludeTax: true } });
    const inclusive = country?.pricesIncludeTax ?? true;
    const live = order.sellerOrders.filter((so) => so.status !== 'CANCELLED');
    if (!live.length) return 0n;

    const totalMinor = sum(live.map((so) => so.subtotalMinor - so.discountMinor + so.deliveryFeeMinor + (inclusive ? 0n : so.taxMinor)));
    const entries = buildCaptureEntries({
      totalMinor,
      taxMinor: sum(live.map((so) => so.taxMinor)),
      taxInclusive: inclusive,
      platformFundedDiscountMinor: order.coupon?.fundedBy === 'PLATFORM' ? sum(live.map((so) => so.discountMinor)) : 0n,
      sellers: live.map((so) => ({ sellerId: so.sellerId, sellerNetMinor: so.sellerNetMinor, commissionMinor: so.commissionMinor, discountMinor: so.discountMinor })),
    });

    await this.ledger.post(
      {
        type: 'ORDER_CAPTURED', refType: 'Order', refId: orderId, idempotencyKey: `order_captured_${orderId}`,
        currencyCode: order.currencyCode, description: `Order ${order.orderNumber} captured`, entries,
      },
      tx,
    );
    return totalMinor;
  }
}
