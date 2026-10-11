export type LineIssue = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'PRICE_CHANGED' | 'WRONG_COUNTRY';

/** Everything the engine needs about one cart line. Built from the DATABASE, never from client input. */
export interface PricingLine {
  itemId: string;
  variantId: string;
  productId: string;
  sellerId: string;
  categoryPath: string;
  quantity: number;
  unitListMinor: bigint; // variant's normal price
  unitPriceMinor: bigint; // price actually charged (deal price if a live campaign applies)
  campaignId: string | null;
}

export interface CouponRule {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED' | 'FREE_DELIVERY';
  scope: 'PLATFORM' | 'SELLER' | 'CATEGORY';
  fundedBy: 'PLATFORM' | 'SELLER';
  valueBps: number | null;
  valueMinor: bigint | null;
  maxDiscountMinor: bigint | null;
  minOrderMinor: bigint;
  sellerId: string | null;
  categoryPath: string | null;
}

export interface TaxConfig {
  rateBps: number; // 0 for Qatar today, 500 UAE, 1500 KSA
  inclusive: boolean; // true = shelf prices already include VAT
}

export interface DeliveryQuote {
  feeMinor: bigint;
  method: string;
  label: string;
}

export type DeliveryQuoteFn = (sellerId: string, goodsNetMinor: bigint) => DeliveryQuote;

export type CouponRejection = 'MIN_ORDER' | 'NO_ELIGIBLE_ITEMS';

export interface PricedLine extends PricingLine {
  lineSubtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  lineTotalMinor: bigint; // subtotal - discount (+ tax if exclusive)
}

export interface PricedGroup {
  sellerId: string;
  lines: PricedLine[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  deliveryFeeMinor: bigint;
  deliveryWaived: boolean;
  delivery: DeliveryQuote;
  taxMinor: bigint;
  totalMinor: bigint;
}

export interface PricedCart {
  groups: PricedGroup[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  deliveryFeeMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  coupon: null | { id: string; code: string; applied: true; discountMinor: bigint; freeDelivery: boolean; fundedBy: string } | { code: string; applied: false; reason: CouponRejection; shortByMinor?: bigint };
}
