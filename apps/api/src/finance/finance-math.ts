import { EntryInput } from '../ledger/ledger.service';
import { allocate, mulDivFloor } from '../pricing/money-math';

/**
 * Refund of R from one seller shipment, reversed in the same proportions the money came in:
 * the seller gives back its share, FastMoveX gives back its commission share, VAT is reversed,
 * and any FastMoveX-funded promo reimbursement is clawed back proportionally.
 * Entries always sum to zero. Pure — exported for tests.
 */
export function buildRefundEntries(i: {
  refundMinor: bigint;
  sellerId: string;
  sellerNetMinor: bigint; // what the seller earned on this shipment (goods - discount + delivery - commission)
  commissionMinor: bigint;
  taxAddedMinor: bigint; // VAT added on top (0 when prices include VAT)
  reimbursementMinor: bigint; // FastMoveX-funded promo paid to the seller at capture
  released: boolean; // earnings already moved to AVAILABLE -> take it back from there
}): EntryInput[] {
  const shipmentTotal = i.sellerNetMinor + i.commissionMinor + i.taxAddedMinor;
  if (i.refundMinor <= 0n || shipmentTotal <= 0n) return [];
  if (i.refundMinor > shipmentTotal) throw new Error('Refund exceeds what was paid for this shipment');

  const [fromSeller, fromCommission, fromTax] = allocate(i.refundMinor, [i.sellerNetMinor, i.commissionMinor, i.taxAddedMinor]);
  const reimbursementBack = mulDivFloor(i.refundMinor, i.reimbursementMinor, shipmentTotal);
  const sellerAccount = i.released ? 'SELLER_AVAILABLE' : 'SELLER_PENDING';

  return ([
    { type: 'CUSTOMER_CLEARING', amountMinor: i.refundMinor }, // cash goes back out
    { type: sellerAccount, sellerId: i.sellerId, amountMinor: -(fromSeller + reimbursementBack) },
    { type: 'PLATFORM_REVENUE', amountMinor: -fromCommission },
    { type: 'TAX_PAYABLE', amountMinor: -fromTax },
    { type: 'PLATFORM_DISCOUNT', amountMinor: reimbursementBack },
  ] as EntryInput[]).filter((e) => e.amountMinor !== 0n);
}

/**
 * Money back for returning `qty` more units of a line, given how many were already refunded.
 * Uses cumulative floors so that returning every unit refunds EXACTLY the line total — no dirham lost or invented.
 */
export function returnRefundAmount(lineTotalMinor: bigint, lineQty: number, alreadyRefundedQty: number, qty: number): bigint {
  if (qty <= 0 || alreadyRefundedQty + qty > lineQty) throw new Error('Invalid return quantity');
  const q = BigInt(lineQty);
  return mulDivFloor(lineTotalMinor, BigInt(alreadyRefundedQty + qty), q) - mulDivFloor(lineTotalMinor, BigInt(alreadyRefundedQty), q);
}

/** Customer-paid total of a shipment: goods - discount + delivery (+ VAT when added on top). */
export function shipmentPaidTotal(so: { subtotalMinor: bigint; discountMinor: bigint; deliveryFeeMinor: bigint; taxMinor: bigint }, taxInclusive: boolean): bigint {
  return so.subtotalMinor - so.discountMinor + so.deliveryFeeMinor + (taxInclusive ? 0n : so.taxMinor);
}

/** Return window: product policy if set, otherwise the seller's default. */
export function returnDeadline(deliveredAt: Date, productDays: number | null, sellerDays: number): Date {
  return new Date(deliveredAt.getTime() + (productDays ?? sellerDays) * 86_400_000);
}
