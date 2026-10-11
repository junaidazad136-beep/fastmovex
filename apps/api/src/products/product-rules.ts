import { BadRequestException } from '@nestjs/common';

/** Pure validation helpers shared by create/update. Exported for unit tests. */

export function assertOptionValues(v: unknown, field = 'optionValues'): Record<string, string> {
  if (v === undefined) return {};
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException(`${field} must be an object`);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 5) throw new BadRequestException(`${field}: max 5 options (e.g. color, size)`);
  for (const [k, val] of entries) {
    if (k.length < 1 || k.length > 30 || typeof val !== 'string' || val.length < 1 || val.length > 50) {
      throw new BadRequestException(`${field}: each option name max 30 chars, value 1-50 chars`);
    }
  }
  return v as Record<string, string>;
}

export function assertSpecs(v: unknown): Record<string, string> {
  if (v === undefined) return {};
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('specs must be an object');
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 50) throw new BadRequestException('specs: max 50 rows');
  for (const [k, val] of entries) {
    if (k.length > 60 || typeof val !== 'string' || val.length > 500) throw new BadRequestException('specs: name max 60, value max 500 chars');
  }
  return v as Record<string, string>;
}

export function assertCompareAt(price: bigint, compareAt: bigint | null | undefined) {
  if (compareAt != null && compareAt <= price) {
    throw new BadRequestException('Old price (compareAtMinor) must be higher than the current price');
  }
}

export function assertUniqueSkus(skus: string[]) {
  const seen = new Set<string>();
  for (const s of skus) {
    const k = s.toUpperCase();
    if (seen.has(k)) throw new BadRequestException(`Duplicate SKU in request: ${s}`);
    seen.add(k);
  }
}

/** Variants with identical option sets confuse customers ("Black/M" twice). */
export function assertDistinctOptions(list: Record<string, string>[]) {
  if (list.length < 2) return;
  const keys = list.map((o) => JSON.stringify(Object.keys(o).sort().map((k) => [k.toLowerCase(), o[k].toLowerCase()])));
  if (new Set(keys).size !== keys.length) throw new BadRequestException('Two variants have exactly the same options');
}

/** Which status transitions a SELLER may cause by editing. Admin moderation is separate. */
export function nextStatusAfterSellerEdit(current: string, submit?: boolean): string {
  if (current === 'ARCHIVED') throw new BadRequestException('Archived products cannot be edited');
  if (submit) {
    if (current === 'DRAFT' || current === 'REJECTED') return 'PENDING_REVIEW';
    return current; // already pending/active
  }
  if (current === 'REJECTED') return 'DRAFT'; // seller is fixing it
  return current;
}

export function stockAfter(onHand: number, reserved: number, delta: number): number {
  const next = onHand + delta;
  if (next < 0) throw new BadRequestException(`Stock cannot go below 0 (current ${onHand})`);
  if (next < reserved) {
    throw new BadRequestException(`${reserved} units are reserved by open orders. Stock cannot go below ${reserved}.`);
  }
  return next;
}
