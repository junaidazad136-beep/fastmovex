import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CouponRule } from './pricing.types';

export type CouponError =
  | 'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'USAGE_LIMIT' | 'LOGIN_REQUIRED'
  | 'PER_USER_LIMIT' | 'FIRST_ORDER_ONLY' | 'NEW_CUSTOMERS_ONLY' | 'MIN_ORDER' | 'NO_ELIGIBLE_ITEMS';

export const COUPON_MESSAGES: Record<CouponError, string> = {
  NOT_FOUND: 'This code is not valid',
  INACTIVE: 'This code is no longer active',
  NOT_STARTED: 'This code is not active yet',
  EXPIRED: 'This code has expired',
  USAGE_LIMIT: 'This code has reached its usage limit',
  LOGIN_REQUIRED: 'Log in to use a promo code',
  PER_USER_LIMIT: 'You have already used this code',
  FIRST_ORDER_ONLY: 'This code is only for your first order',
  NEW_CUSTOMERS_ONLY: 'This code is only for new customers',
  MIN_ORDER: 'Add more items to use this code',
  NO_ELIGIBLE_ITEMS: 'None of the items in your cart qualify for this code',
};

export interface CouponFacts {
  now: Date;
  userId?: string;
  userCreatedAt?: Date;
  userOrderCount: number; // non-cancelled orders
  userRedemptions: number;
}

export interface CouponRow {
  id: string; code: string; type: CouponRule['type']; scope: CouponRule['scope']; fundedBy: CouponRule['fundedBy'];
  valueBps: number | null; valueMinor: bigint | null; maxDiscountMinor: bigint | null; minOrderMinor: bigint;
  sellerId: string | null; category: { path: string } | null;
  firstOrderOnly: boolean; newCustomerDays: number | null; startsAt: Date; endsAt: Date;
  usageLimit: number | null; perUserLimit: number; usedCount: number; isActive: boolean;
}

/** Pure eligibility check (who/when). Cart-content checks (min order, scope) happen in the pricing engine. */
export function checkCouponFacts(c: CouponRow, f: CouponFacts): CouponError | null {
  if (!c.isActive) return 'INACTIVE';
  if (f.now < c.startsAt) return 'NOT_STARTED';
  if (f.now >= c.endsAt) return 'EXPIRED';
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'USAGE_LIMIT';
  if (!f.userId) return 'LOGIN_REQUIRED'; // per-user limits cannot be enforced for guests
  if (f.userRedemptions >= c.perUserLimit) return 'PER_USER_LIMIT';
  if (c.firstOrderOnly && f.userOrderCount > 0) return 'FIRST_ORDER_ONLY';
  if (c.newCustomerDays !== null && f.userCreatedAt && f.now.getTime() - f.userCreatedAt.getTime() > c.newCustomerDays * 86_400_000) {
    return 'NEW_CUSTOMERS_ONLY';
  }
  return null;
}

export function toRule(c: CouponRow): CouponRule {
  return {
    id: c.id, code: c.code, type: c.type, scope: c.scope, fundedBy: c.fundedBy, valueBps: c.valueBps, valueMinor: c.valueMinor,
    maxDiscountMinor: c.maxDiscountMinor, minOrderMinor: c.minOrderMinor, sellerId: c.sellerId, categoryPath: c.category?.path ?? null,
  };
}

export const normalizeCode = (code: string) => code.trim().toUpperCase();

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loads the coupon plus the user facts needed to judge it. Returns a rule ready for the pricing engine, or an error code. */
  async resolve(code: string, countryCode: string, userId?: string, now = new Date(), newCustomer = false): Promise<{ rule: CouponRule } | { error: CouponError }> {
    const c = await this.prisma.coupon.findUnique({
      where: { code_countryCode: { code: normalizeCode(code), countryCode } },
      include: { category: { select: { path: true } } },
    });
    if (!c) return { error: 'NOT_FOUND' };

    let facts: CouponFacts = { now, userOrderCount: 0, userRedemptions: 0 };
    // a caller who gets a profile when staff place the phone order: no orders, no redemptions, joined now
    if (!userId && newCustomer) facts = { now, userId: 'new-customer', userCreatedAt: now, userOrderCount: 0, userRedemptions: 0 };
    if (userId) {
      const [user, orders, redemptions] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
        this.prisma.order.count({ where: { userId, status: { notIn: ['CANCELLED'] } } }),
        this.prisma.couponRedemption.count({ where: { couponId: c.id, userId } }),
      ]);
      facts = { now, userId, userCreatedAt: user?.createdAt, userOrderCount: orders, userRedemptions: redemptions };
    }
    const err = checkCouponFacts(c as CouponRow, facts);
    return err ? { error: err } : { rule: toRule(c as CouponRow) };
  }
}
