import { allocate, max, min, mulDivFloor, mulDivRound, sum } from './money-math';
import { CouponRule, DeliveryQuoteFn, PricedCart, PricedGroup, PricedLine, PricingLine, TaxConfig } from './pricing.types';

const BPS = 10_000n;

export function isLineEligible(line: PricingLine, c: CouponRule): boolean {
  if (c.scope === 'SELLER') return line.sellerId === c.sellerId;
  if (c.scope === 'CATEGORY') return !!c.categoryPath && (line.categoryPath === c.categoryPath || line.categoryPath.startsWith(`${c.categoryPath}/`));
  return true;
}

/** VAT in (inclusive) or on top of (exclusive) an amount. Exported for order changes. */
export function taxOn(amount: bigint, tax: TaxConfig): bigint {
  if (tax.rateBps <= 0 || amount <= 0n) return 0n;
  const r = BigInt(tax.rateBps);
  return tax.inclusive ? mulDivRound(amount, r, BPS + r) : mulDivRound(amount, r, BPS);
}

/**
 * THE price calculator. Pure and deterministic: same input -> same output, no DB, no clock.
 * Cart view and checkout both call this, so the customer is charged exactly what the cart showed.
 *
 * Order of operations:
 *   1. line subtotal = unit price x qty (unit price already includes any live campaign price)
 *   2. coupon discount on eligible lines, spread across them to the exact dirham
 *   3. delivery per seller shipment, quoted on goods AFTER discount (free delivery coupon waives it)
 *   4. VAT per line and on delivery (inclusive = extracted for display, exclusive = added)
 */
export function priceCart(input: { lines: PricingLine[]; coupon?: CouponRule | null; tax: TaxConfig; quoteDelivery: DeliveryQuoteFn }): PricedCart {
  const { lines, coupon, tax, quoteDelivery } = input;
  const subtotals = lines.map((l) => l.unitPriceMinor * BigInt(l.quantity));
  const discounts = lines.map(() => 0n);
  let couponResult: PricedCart['coupon'] = null;
  const waiveDeliveryFor = new Set<string>();

  if (coupon) {
    const eligibleIdx = lines.map((l, i) => (isLineEligible(l, coupon) ? i : -1)).filter((i) => i >= 0);
    const eligibleSubtotal = sum(eligibleIdx.map((i) => subtotals[i]));

    if (!eligibleIdx.length) {
      couponResult = { code: coupon.code, applied: false, reason: 'NO_ELIGIBLE_ITEMS' };
    } else if (eligibleSubtotal < coupon.minOrderMinor) {
      couponResult = { code: coupon.code, applied: false, reason: 'MIN_ORDER', shortByMinor: coupon.minOrderMinor - eligibleSubtotal };
    } else {
      let total = 0n;
      if (coupon.type === 'PERCENTAGE') {
        total = mulDivFloor(eligibleSubtotal, BigInt(coupon.valueBps ?? 0), BPS);
        if (coupon.maxDiscountMinor != null) total = min(total, coupon.maxDiscountMinor);
      } else if (coupon.type === 'FIXED') {
        total = min(coupon.valueMinor ?? 0n, eligibleSubtotal);
      } else {
        eligibleIdx.forEach((i) => waiveDeliveryFor.add(lines[i].sellerId));
      }
      const shares = allocate(total, eligibleIdx.map((i) => subtotals[i]));
      eligibleIdx.forEach((lineIdx, k) => (discounts[lineIdx] = shares[k]));
      couponResult = { id: coupon.id, code: coupon.code, applied: true, discountMinor: total, freeDelivery: coupon.type === 'FREE_DELIVERY', fundedBy: coupon.fundedBy };
    }
  }

  // Group by seller, keeping first-seen order (stable UI)
  const sellerOrder: string[] = [];
  const bySeller = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (!bySeller.has(l.sellerId)) { bySeller.set(l.sellerId, []); sellerOrder.push(l.sellerId); }
    bySeller.get(l.sellerId)!.push(i);
  });

  const groups: PricedGroup[] = sellerOrder.map((sellerId) => {
    const idx = bySeller.get(sellerId)!;
    const pricedLines: PricedLine[] = idx.map((i) => {
      const net = subtotals[i] - discounts[i];
      const t = taxOn(net, tax);
      return { ...lines[i], lineSubtotalMinor: subtotals[i], discountMinor: discounts[i], taxMinor: t, lineTotalMinor: tax.inclusive ? net : net + t };
    });
    const subtotalMinor = sum(pricedLines.map((l) => l.lineSubtotalMinor));
    const discountMinor = sum(pricedLines.map((l) => l.discountMinor));
    const goodsNet = subtotalMinor - discountMinor;
    const delivery = quoteDelivery(sellerId, goodsNet);
    const waived = waiveDeliveryFor.has(sellerId) && delivery.feeMinor > 0n;
    const deliveryFeeMinor = waived ? 0n : max(0n, delivery.feeMinor);
    const deliveryTax = taxOn(deliveryFeeMinor, tax);
    const taxMinor = sum(pricedLines.map((l) => l.taxMinor)) + deliveryTax;
    const totalMinor = goodsNet + deliveryFeeMinor + (tax.inclusive ? 0n : taxMinor);
    return { sellerId, lines: pricedLines, subtotalMinor, discountMinor, deliveryFeeMinor, deliveryWaived: waived, delivery, taxMinor, totalMinor };
  });

  // Free-delivery coupon "value" = delivery actually waived (for reporting and for who pays it)
  if (couponResult?.applied && couponResult.freeDelivery) {
    couponResult.discountMinor = sum(groups.filter((g) => g.deliveryWaived).map((g) => g.delivery.feeMinor));
  }

  return {
    groups,
    subtotalMinor: sum(groups.map((g) => g.subtotalMinor)),
    discountMinor: sum(groups.map((g) => g.discountMinor)),
    deliveryFeeMinor: sum(groups.map((g) => g.deliveryFeeMinor)),
    taxMinor: sum(groups.map((g) => g.taxMinor)),
    totalMinor: sum(groups.map((g) => g.totalMinor)),
    coupon: couponResult,
  };
}
