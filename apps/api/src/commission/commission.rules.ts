import { CommissionScope, CommissionType } from '@prisma/client';
import { max, min, mulDivFloor } from '../pricing/money-math';

/** More specific scope wins, regardless of priority value. */
export const SCOPE_RANK: Record<CommissionScope, number> = { PRODUCT: 5, CAMPAIGN: 4, SELLER: 3, CATEGORY: 2, COUNTRY: 1, GLOBAL: 0 };

export interface Rule {
  id: string;
  name: string;
  scope: CommissionScope;
  countryCode: string | null;
  categoryPath: string | null;
  sellerId: string | null;
  productId: string | null;
  campaignId: string | null;
  type: CommissionType;
  rateBps: number | null;
  fixedMinor: bigint | null;
  minMinor: bigint | null;
  maxMinor: bigint | null;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export interface CommissionTarget {
  countryCode: string;
  categoryPath: string;
  sellerId: string;
  productId: string;
  campaignId: string | null;
  quantity: number;
  netAmountMinor: bigint; // commission base: what the seller earns for the goods (see CheckoutService.commissionFor)
}

export function ruleApplies(r: Rule, t: CommissionTarget, now: Date): boolean {
  if (!r.isActive) return false;
  if (r.startsAt && now < r.startsAt) return false;
  if (r.endsAt && now >= r.endsAt) return false;
  if (r.countryCode && r.countryCode !== t.countryCode) return false;
  switch (r.scope) {
    case 'PRODUCT': return r.productId === t.productId;
    case 'CAMPAIGN': return !!t.campaignId && r.campaignId === t.campaignId;
    case 'SELLER': return r.sellerId === t.sellerId;
    case 'CATEGORY': return !!r.categoryPath && (t.categoryPath === r.categoryPath || t.categoryPath.startsWith(`${r.categoryPath}/`));
    case 'COUNTRY': return r.countryCode === t.countryCode;
    case 'GLOBAL': return true;
  }
}

/** PRODUCT > CAMPAIGN > SELLER > CATEGORY > COUNTRY > GLOBAL, then higher priority, then deeper category. */
export function pickRule(rules: Rule[], t: CommissionTarget, now: Date): Rule | null {
  const applicable = rules.filter((r) => ruleApplies(r, t, now));
  if (!applicable.length) return null;
  return applicable.sort((a, b) => {
    const rank = SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope];
    if (rank !== 0) return rank;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (b.categoryPath?.length ?? 0) - (a.categoryPath?.length ?? 0);
  })[0];
}

export interface CommissionResult {
  commissionMinor: bigint;
  ruleId: string | null;
  snapshot: Record<string, unknown>; // stored on the order item so the split stays explainable years later
}

export function computeCommission(rules: Rule[], t: CommissionTarget, now = new Date()): CommissionResult {
  const rule = pickRule(rules, t, now);
  if (!rule) {
    return { commissionMinor: 0n, ruleId: null, snapshot: { reason: 'NO_RULE_MATCHED', netAmountMinor: t.netAmountMinor.toString() } };
  }
  let commission = rule.type === 'PERCENTAGE'
    ? mulDivFloor(t.netAmountMinor, BigInt(rule.rateBps ?? 0), 10_000n)
    : (rule.fixedMinor ?? 0n) * BigInt(t.quantity);

  if (rule.minMinor != null) commission = max(commission, rule.minMinor);
  if (rule.maxMinor != null) commission = min(commission, rule.maxMinor);
  commission = min(max(commission, 0n), t.netAmountMinor); // never more than the line itself

  return {
    commissionMinor: commission,
    ruleId: rule.id,
    snapshot: {
      ruleId: rule.id, ruleName: rule.name, scope: rule.scope, type: rule.type,
      rateBps: rule.rateBps, fixedMinor: rule.fixedMinor?.toString() ?? null,
      minMinor: rule.minMinor?.toString() ?? null, maxMinor: rule.maxMinor?.toString() ?? null,
      netAmountMinor: t.netAmountMinor.toString(), commissionMinor: commission.toString(),
    },
  };
}
