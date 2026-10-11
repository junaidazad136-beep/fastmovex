import { allocate, mulDivRound, sum } from '../src/pricing/money-math';
import { checkCouponFacts, CouponRow } from '../src/pricing/coupon.service';
import { parseConfig, ConfigDeliveryQuoter } from '../src/pricing/delivery-quoter';
import { priceCart } from '../src/pricing/pricing.engine';
import { CouponRule, PricingLine } from '../src/pricing/pricing.types';
import { validateCouponShape } from '../src/coupons/coupons';

const line = (o: Partial<PricingLine> & { itemId: string; sellerId: string; unitPriceMinor: bigint; quantity: number }): PricingLine => ({
  variantId: `v-${o.itemId}`, productId: `p-${o.itemId}`, categoryPath: 'electronics/phones', unitListMinor: o.unitPriceMinor, campaignId: null, ...o,
});
const coupon = (o: Partial<CouponRule>): CouponRule => ({
  id: 'c1', code: 'SAVE', type: 'PERCENTAGE', scope: 'PLATFORM', fundedBy: 'PLATFORM', valueBps: 1000, valueMinor: null,
  maxDiscountMinor: null, minOrderMinor: 0n, sellerId: null, categoryPath: null, ...o,
});
const NO_TAX = { rateBps: 0, inclusive: true };
const flat = (fee: bigint, freeOver: bigint | null = null) => (_s: string, net: bigint) => ({ feeMinor: freeOver !== null && net >= freeOver ? 0n : fee, method: 'STANDARD', label: 'x' });

// Two sellers in one cart: A sells a phone (QAR 100 x2), B sells a case (QAR 33.33 x3)
const twoSellers = [
  line({ itemId: 'a1', sellerId: 'A', unitPriceMinor: 10000n, quantity: 2 }),
  line({ itemId: 'b1', sellerId: 'B', unitPriceMinor: 3333n, quantity: 3, categoryPath: 'fashion/bags' }),
];

describe('money math', () => {
  it('allocate always sums exactly and is proportional', () => {
    const parts = allocate(1000n, [3333n, 3333n, 3334n]);
    expect(sum(parts)).toBe(1000n);
    expect(allocate(7n, [1n, 1n, 1n])).toEqual([3n, 2n, 2n]);
    expect(allocate(0n, [5n, 5n])).toEqual([0n, 0n]);
  });
  it('rounds half-up on integers', () => {
    expect(mulDivRound(105n, 1n, 10n)).toBe(11n);
    expect(mulDivRound(104n, 1n, 10n)).toBe(10n);
  });
});

describe('priceCart', () => {
  it('two sellers: separate groups, separate delivery, exact totals', () => {
    const r = priceCart({ lines: twoSellers, tax: NO_TAX, quoteDelivery: flat(1000n) });
    expect(r.groups.map((g) => g.sellerId)).toEqual(['A', 'B']);
    expect(r.groups[0]).toMatchObject({ subtotalMinor: 20000n, deliveryFeeMinor: 1000n, totalMinor: 21000n });
    expect(r.groups[1]).toMatchObject({ subtotalMinor: 9999n, deliveryFeeMinor: 1000n, totalMinor: 10999n });
    expect(r.totalMinor).toBe(31999n);
  });

  it('free delivery threshold is per seller, judged after discount', () => {
    const r = priceCart({ lines: twoSellers, tax: NO_TAX, quoteDelivery: flat(1000n, 15000n) });
    expect(r.groups[0].deliveryFeeMinor).toBe(0n); // 200 >= 150
    expect(r.groups[1].deliveryFeeMinor).toBe(1000n); // 99.99 < 150
  });

  it('10% platform coupon: discount spread across sellers, sums to the dirham', () => {
    const r = priceCart({ lines: twoSellers, coupon: coupon({}), tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(r.discountMinor).toBe(2999n); // floor(29999 * 10%)
    const perLine = r.groups.flatMap((g) => g.lines.map((l) => l.discountMinor));
    expect(sum(perLine)).toBe(2999n);
    expect(r.totalMinor).toBe(29999n - 2999n);
  });

  it('percentage coupon respects max discount cap', () => {
    const r = priceCart({ lines: twoSellers, coupon: coupon({ valueBps: 5000, maxDiscountMinor: 2500n }), tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(r.discountMinor).toBe(2500n);
  });

  it('fixed coupon can never exceed the eligible amount (no negative totals)', () => {
    const r = priceCart({ lines: [line({ itemId: 'x', sellerId: 'A', unitPriceMinor: 500n, quantity: 1 })], coupon: coupon({ type: 'FIXED', valueBps: null, valueMinor: 5000n }), tax: NO_TAX, quoteDelivery: flat(1000n) });
    expect(r.discountMinor).toBe(500n);
    expect(r.totalMinor).toBe(1000n); // delivery only
  });

  it('seller coupon only discounts that seller\'s items', () => {
    const r = priceCart({ lines: twoSellers, coupon: coupon({ scope: 'SELLER', sellerId: 'B', fundedBy: 'SELLER' }), tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(r.groups[0].discountMinor).toBe(0n);
    expect(r.groups[1].discountMinor).toBe(999n);
  });

  it('category coupon matches the whole subtree only', () => {
    const r = priceCart({ lines: twoSellers, coupon: coupon({ scope: 'CATEGORY', categoryPath: 'electronics' }), tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(r.groups[0].discountMinor).toBe(2000n);
    expect(r.groups[1].discountMinor).toBe(0n);
    const noMatch = priceCart({ lines: twoSellers, coupon: coupon({ scope: 'CATEGORY', categoryPath: 'elec' }), tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(noMatch.coupon).toMatchObject({ applied: false, reason: 'NO_ELIGIBLE_ITEMS' });
  });

  it('min order is checked on eligible items and reports how much is missing', () => {
    const r = priceCart({ lines: twoSellers, coupon: coupon({ minOrderMinor: 50000n }), tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(r.coupon).toEqual({ code: 'SAVE', applied: false, reason: 'MIN_ORDER', shortByMinor: 20001n });
    expect(r.discountMinor).toBe(0n);
  });

  it('free-delivery coupon waives delivery for eligible sellers and reports its value', () => {
    const r = priceCart({ lines: twoSellers, coupon: coupon({ type: 'FREE_DELIVERY', valueBps: null, scope: 'SELLER', sellerId: 'A' }), tax: NO_TAX, quoteDelivery: flat(1000n) });
    expect(r.groups[0]).toMatchObject({ deliveryFeeMinor: 0n, deliveryWaived: true });
    expect(r.groups[1].deliveryFeeMinor).toBe(1000n);
    expect(r.coupon).toMatchObject({ applied: true, freeDelivery: true, discountMinor: 1000n });
  });

  it('VAT exclusive (e.g. KSA 15%) is added on goods and delivery', () => {
    const r = priceCart({ lines: [line({ itemId: 'x', sellerId: 'A', unitPriceMinor: 10000n, quantity: 1 })], tax: { rateBps: 1500, inclusive: false }, quoteDelivery: flat(1000n) });
    expect(r.taxMinor).toBe(1500n + 150n);
    expect(r.totalMinor).toBe(10000n + 1000n + 1650n);
  });

  it('VAT inclusive (e.g. UAE 5%) is extracted, total unchanged', () => {
    const r = priceCart({ lines: [line({ itemId: 'x', sellerId: 'A', unitPriceMinor: 10500n, quantity: 1 })], tax: { rateBps: 500, inclusive: true }, quoteDelivery: flat(0n) });
    expect(r.taxMinor).toBe(500n);
    expect(r.totalMinor).toBe(10500n);
  });

  it('Qatar today: 0% VAT means no tax lines at all', () => {
    const r = priceCart({ lines: twoSellers, tax: NO_TAX, quoteDelivery: flat(0n) });
    expect(r.taxMinor).toBe(0n);
  });

  it('is deterministic (cart view == checkout)', () => {
    const args = { lines: twoSellers, coupon: coupon({}), tax: { rateBps: 500, inclusive: false }, quoteDelivery: flat(1000n, 15000n) };
    expect(priceCart(args)).toEqual(priceCart(args));
  });

  it('empty cart prices to zero', () => {
    expect(priceCart({ lines: [], tax: NO_TAX, quoteDelivery: flat(1000n) }).totalMinor).toBe(0n);
  });
});

describe('coupon eligibility (abuse cases)', () => {
  const base: CouponRow = {
    id: 'c', code: 'X', type: 'PERCENTAGE', scope: 'PLATFORM', fundedBy: 'PLATFORM', valueBps: 1000, valueMinor: null, maxDiscountMinor: null,
    minOrderMinor: 0n, sellerId: null, category: null, firstOrderOnly: false, newCustomerDays: null,
    startsAt: new Date('2026-09-01'), endsAt: new Date('2026-10-01'), usageLimit: 100, perUserLimit: 1, usedCount: 0, isActive: true,
  };
  const now = new Date('2026-09-22');
  const user = { now, userId: 'u', userCreatedAt: new Date('2026-09-20'), userOrderCount: 0, userRedemptions: 0 };

  it('valid for eligible user', () => expect(checkCouponFacts(base, user)).toBeNull());
  it('expired / not started / inactive', () => {
    expect(checkCouponFacts(base, { ...user, now: new Date('2026-10-02') })).toBe('EXPIRED');
    expect(checkCouponFacts(base, { ...user, now: new Date('2026-08-01') })).toBe('NOT_STARTED');
    expect(checkCouponFacts({ ...base, isActive: false }, user)).toBe('INACTIVE');
  });
  it('global usage limit', () => expect(checkCouponFacts({ ...base, usedCount: 100 }, user)).toBe('USAGE_LIMIT'));
  it('guests cannot use coupons', () => expect(checkCouponFacts(base, { now, userOrderCount: 0, userRedemptions: 0 })).toBe('LOGIN_REQUIRED'));
  it('same user cannot reuse', () => expect(checkCouponFacts(base, { ...user, userRedemptions: 1 })).toBe('PER_USER_LIMIT'));
  it('first-order coupon blocked after first order', () => expect(checkCouponFacts({ ...base, firstOrderOnly: true }, { ...user, userOrderCount: 1 })).toBe('FIRST_ORDER_ONLY'));
  it('new-customer window', () => {
    expect(checkCouponFacts({ ...base, newCustomerDays: 7 }, user)).toBeNull();
    expect(checkCouponFacts({ ...base, newCustomerDays: 7 }, { ...user, userCreatedAt: new Date('2026-01-01') })).toBe('NEW_CUSTOMERS_ONLY');
  });
});

describe('delivery config', () => {
  it('parses admin config safely', () => {
    expect(parseConfig({ flatFeeMinor: '1000', freeOverMinor: '10000' })).toMatchObject({ flatFee: 1000n, freeOver: 10000n });
    expect(parseConfig({ flatFeeMinor: '-5', freeOverMinor: 'abc' })).toMatchObject({ flatFee: 0n, freeOver: null });
    expect(parseConfig(null)).toMatchObject({ flatFee: 0n });
  });
  it('quotes free at/above threshold', () => {
    const q = new ConfigDeliveryQuoter().forCountry({ flatFeeMinor: '1000', freeOverMinor: '10000' });
    expect(q('s', 9999n).feeMinor).toBe(1000n);
    expect(q('s', 10000n)).toMatchObject({ feeMinor: 0n, label: 'Free delivery' });
  });
});

describe('coupon shape validation', () => {
  const ok = { code: 'X10', type: 'PERCENTAGE' as const, valueBps: 1000, startsAt: new Date('2026-09-01'), endsAt: new Date('2026-10-01') };
  it('accepts a valid coupon', () => expect(() => validateCouponShape(ok)).not.toThrow());
  it('rejects end before start', () => expect(() => validateCouponShape({ ...ok, endsAt: new Date('2026-08-01') })).toThrow('endsAt'));
  it('rejects FIXED without amount', () => expect(() => validateCouponShape({ ...ok, type: 'FIXED', valueBps: undefined })).toThrow('valueMinor'));
  it('rejects SELLER scope without seller', () => expect(() => validateCouponShape({ ...ok, scope: 'SELLER' })).toThrow('sellerId'));
});
