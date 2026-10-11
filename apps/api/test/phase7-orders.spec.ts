import { BadRequestException } from '@nestjs/common';
import { assertAddressFormat } from '../src/addresses/addresses';
import { computeCommission, pickRule, Rule } from '../src/commission/commission.rules';
import { buildCaptureEntries } from '../src/ledger/order-ledger.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { allowedNext, assertTransition, buildOrderNumber, deriveOrderStatus } from '../src/orders/order-status';
import { sum } from '../src/pricing/money-math';

describe('order status machine', () => {
  it('seller can only move forward through the real flow', () => {
    expect(allowedNext('CONFIRMED', 'SELLER')).toEqual(['PREPARING', 'CANCELLED']);
    expect(() => assertTransition('CONFIRMED', 'DELIVERED', 'SELLER')).toThrow(BadRequestException);
    expect(() => assertTransition('PREPARING', 'SHIPPED', 'SELLER')).not.toThrow();
    expect(() => assertTransition('DELIVERED', 'PREPARING', 'SELLER')).toThrow();
  });

  it('customer can only cancel before the seller ships', () => {
    expect(allowedNext('PENDING', 'CUSTOMER')).toEqual(['CANCELLED']);
    expect(allowedNext('SHIPPED', 'CUSTOMER')).toEqual([]);
  });

  it('admin can cancel anything that has not left the seller', () => {
    expect(allowedNext('PREPARING', 'ADMIN')).toContain('CANCELLED');
    expect(allowedNext('SHIPPED', 'ADMIN')).not.toContain('CANCELLED');
  });

  it('customer status of a multi-seller order = least advanced live shipment', () => {
    expect(deriveOrderStatus(['DELIVERED', 'PREPARING'])).toBe('PREPARING');
    expect(deriveOrderStatus(['DELIVERED', 'DELIVERED'])).toBe('DELIVERED');
    expect(deriveOrderStatus(['CANCELLED', 'SHIPPED'])).toBe('SHIPPED'); // one seller cancelling does not cancel the order
    expect(deriveOrderStatus(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
    expect(deriveOrderStatus([])).toBe('PENDING');
  });

  it('order number carries market and date but leaks no sequence', () => {
    expect(buildOrderNumber('QA', new Date('2026-09-22T10:00:00Z'), '4f9a2c')).toBe('FMX-QA-260922-4F9A2C');
  });
});

describe('commission engine', () => {
  const rule = (o: Partial<Rule>): Rule => ({
    id: 'r', name: 'r', scope: 'GLOBAL', countryCode: null, categoryPath: null, sellerId: null, productId: null, campaignId: null,
    type: 'PERCENTAGE', rateBps: 1000, fixedMinor: null, minMinor: null, maxMinor: null, priority: 0, startsAt: null, endsAt: null, isActive: true, ...o,
  });
  const target = { countryCode: 'QA', categoryPath: 'electronics/phones', sellerId: 'A', productId: 'P', campaignId: null, quantity: 2, netAmountMinor: 20000n };
  const now = new Date('2026-09-22');

  it('more specific rule wins: product > seller > category > country', () => {
    const rules = [
      rule({ id: 'country', scope: 'COUNTRY', countryCode: 'QA', rateBps: 1000 }),
      rule({ id: 'cat', scope: 'CATEGORY', categoryPath: 'electronics', rateBps: 700 }),
      rule({ id: 'seller', scope: 'SELLER', sellerId: 'A', rateBps: 500 }),
      rule({ id: 'product', scope: 'PRODUCT', productId: 'P', rateBps: 300 }),
    ];
    expect(pickRule(rules, target, now)?.id).toBe('product');
    expect(pickRule(rules.slice(0, 3), target, now)?.id).toBe('seller');
    expect(pickRule(rules.slice(0, 2), target, now)?.id).toBe('cat');
  });

  it('category rule applies to subcategories', () => {
    expect(pickRule([rule({ scope: 'CATEGORY', categoryPath: 'electronics' })], target, now)).not.toBeNull();
    expect(pickRule([rule({ scope: 'CATEGORY', categoryPath: 'fashion' })], target, now)).toBeNull();
  });

  it('expired or inactive rules are ignored', () => {
    expect(pickRule([rule({ endsAt: new Date('2026-01-01') })], target, now)).toBeNull();
    expect(pickRule([rule({ isActive: false })], target, now)).toBeNull();
  });

  it('percentage, fixed-per-unit, min and max', () => {
    expect(computeCommission([rule({ rateBps: 700 })], target, now).commissionMinor).toBe(1400n);
    expect(computeCommission([rule({ type: 'FIXED', rateBps: null, fixedMinor: 500n })], target, now).commissionMinor).toBe(1000n);
    expect(computeCommission([rule({ rateBps: 100, minMinor: 1000n })], target, now).commissionMinor).toBe(1000n);
    expect(computeCommission([rule({ rateBps: 5000, maxMinor: 2000n })], target, now).commissionMinor).toBe(2000n);
  });

  it('never exceeds the seller amount, and no rule means zero commission', () => {
    expect(computeCommission([rule({ type: 'FIXED', rateBps: null, fixedMinor: 999999n })], target, now).commissionMinor).toBe(20000n);
    const none = computeCommission([], target, now);
    expect(none.commissionMinor).toBe(0n);
    expect(none.ruleId).toBeNull();
  });

  it('stores a snapshot so later rule edits never rewrite history', () => {
    const r = computeCommission([rule({ id: 'r1', name: 'Electronics 7%', rateBps: 700 })], target, now);
    expect(r.snapshot).toMatchObject({ ruleId: 'r1', ruleName: 'Electronics 7%', rateBps: 700 });
  });
});

describe('ledger', () => {
  const capture = {
    totalMinor: 31000n, taxMinor: 0n, taxInclusive: true, platformFundedDiscountMinor: 0n,
    sellers: [
      { sellerId: 'A', sellerNetMinor: 19000n, commissionMinor: 2000n, discountMinor: 0n },
      { sellerId: 'B', sellerNetMinor: 9000n, commissionMinor: 1000n, discountMinor: 0n },
    ],
  };

  it('order capture entries always balance to zero', () => {
    expect(sum(buildCaptureEntries(capture).map((e) => e.amountMinor))).toBe(0n);
  });

  it('seller earnings land in SELLER_PENDING, commission in PLATFORM_REVENUE', () => {
    const e = buildCaptureEntries(capture);
    expect(e.find((x) => x.sellerId === 'A')).toMatchObject({ type: 'SELLER_PENDING', amountMinor: 19000n });
    expect(e.find((x) => x.type === 'PLATFORM_REVENUE')?.amountMinor).toBe(3000n);
    expect(e.find((x) => x.type === 'CUSTOMER_CLEARING')?.amountMinor).toBe(-31000n);
  });

  it('a FastMoveX-funded coupon is an expense and the seller is reimbursed', () => {
    const e = buildCaptureEntries({
      totalMinor: 19000n, taxMinor: 0n, taxInclusive: true, platformFundedDiscountMinor: 2000n,
      sellers: [{ sellerId: 'A', sellerNetMinor: 17000n, commissionMinor: 2000n, discountMinor: 2000n }],
    });
    expect(sum(e.map((x) => x.amountMinor))).toBe(0n);
    expect(e.find((x) => x.sellerId === 'A')?.amountMinor).toBe(19000n); // 17000 + 2000 reimbursed
    expect(e.find((x) => x.type === 'PLATFORM_DISCOUNT')?.amountMinor).toBe(-2000n);
  });

  it('VAT added on top is posted as tax payable', () => {
    const e = buildCaptureEntries({ ...capture, taxInclusive: false, taxMinor: 1500n, totalMinor: 32500n });
    expect(e.find((x) => x.type === 'TAX_PAYABLE')?.amountMinor).toBe(1500n);
    expect(sum(e.map((x) => x.amountMinor))).toBe(0n);
  });

  it('unbalanced entries are refused before they reach the database', async () => {
    const svc = new LedgerService({ ledgerTransaction: { findUnique: jest.fn() } } as never);
    await expect(svc.post({ type: 'X', refType: 'T', refId: '1', idempotencyKey: 'k', currencyCode: 'QAR', entries: [{ type: 'PLATFORM_REVENUE', amountMinor: 5n }] })).rejects.toThrow('unbalanced');
  });

  it('replaying the same event does not double-post', async () => {
    const create = jest.fn();
    const prisma = { ledgerTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 'tx1' }), create }, ledgerAccount: {} };
    const svc = new LedgerService(prisma as never);
    await svc.post({ type: 'ORDER_CAPTURED', refType: 'Order', refId: 'o1', idempotencyKey: 'order_captured_o1', currencyCode: 'QAR', entries: buildCaptureEntries(capture) });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('addresses', () => {
  const qatarFormat = { fields: ['city', 'zone', 'street', 'building'], required: ['city', 'zone', 'street', 'building'] };
  const base = { recipientName: 'Junaid', phone: '+97455555555', city: 'Doha' };

  it('Qatar requires zone/street/building', () => {
    expect(() => assertAddressFormat(base as never, qatarFormat)).toThrow(BadRequestException);
    expect(() => assertAddressFormat({ ...base, zone: '24', street: '850', building: '12' } as never, qatarFormat)).not.toThrow();
  });

  it('a market with free-text addresses only needs its own fields', () => {
    expect(() => assertAddressFormat({ ...base, line1: 'Street 1' } as never, { required: ['city', 'line1'] })).not.toThrow();
  });
});
