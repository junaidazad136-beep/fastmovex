/** Integer-only money helpers. All amounts are BigInt minor units. No floats anywhere. */

/** a * num / den, rounded half-up (for non-negative values). */
export function mulDivRound(a: bigint, num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error('den must be > 0');
  if (a < 0n || num < 0n) throw new Error('mulDivRound expects non-negative inputs');
  return (a * num + den / 2n) / den;
}

/** a * num / den, rounded down. Used for discounts (never give away more than configured). */
export function mulDivFloor(a: bigint, num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error('den must be > 0');
  return (a * num) / den;
}

export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const max = (a: bigint, b: bigint) => (a > b ? a : b);
export const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);

/**
 * Splits `total` across parts proportionally to `weights` so the parts ALWAYS add up to exactly `total`
 * (largest-remainder method). Used to spread a coupon discount across order lines for refunds/commission.
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  if (total < 0n) throw new Error('allocate expects total >= 0');
  const W = sum(weights);
  if (W === 0n || weights.length === 0) return weights.map(() => 0n);
  const shares = weights.map((w) => (total * w) / W);
  let remainder = total - sum(shares);
  const order = weights
    .map((w, i) => ({ i, frac: (total * w) % W }))
    .sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1));
  for (let k = 0; remainder > 0n; k++, remainder--) shares[order[k % order.length].i] += 1n;
  return shares;
}
