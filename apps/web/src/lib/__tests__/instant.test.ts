import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '../api/types';
import { haptic } from '../haptics';
import { withQuantity } from '../state/cart';

const line = (id: string, quantity: number, unit: string) => ({ id, variantId: `v-${id}`, quantity, unitPriceMinor: unit, lineSubtotalMinor: String(BigInt(unit) * BigInt(quantity)) });
const cart = {
  groups: [
    { store: { slug: 'a' }, items: [line('1', 2, '1500'), line('2', 1, '990')] },
    { store: { slug: 'b' }, items: [line('3', 1, '4500')] },
  ],
  totals: { itemCount: 4, subtotalMinor: '8490', totalMinor: '8490' },
} as unknown as Cart;

describe('cart changes on screen before the server answers', () => {
  it('a new quantity changes the line, its price and the item count; money totals wait for the server', () => {
    const c = withQuantity(cart, '1', 5)!;
    expect(c.groups[0].items[0]).toMatchObject({ quantity: 5, lineSubtotalMinor: '7500' });
    expect(c.totals.itemCount).toBe(7);
    expect(c.totals.totalMinor).toBe('8490');
  });
  it('removing the last item of a store drops that store', () => {
    const c = withQuantity(cart, '3', 0)!;
    expect(c.groups.map((g) => g.store.slug)).toEqual(['a']);
    expect(c.totals.itemCount).toBe(3);
  });
  it('an item no longer in the cart changes nothing', () => {
    expect(withQuantity(cart, 'gone', 2)).toBeNull();
  });
});

describe('vibration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('buzzes on phones that can, and stays quiet where it cannot or the shopper asked for less motion', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    haptic('success');
    haptic('done');
    expect(vibrate).toHaveBeenNthCalledWith(1, 22);
    expect(vibrate).toHaveBeenNthCalledWith(2, [24, 70, 36]);

    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    haptic('tap');
    expect(vibrate).toHaveBeenCalledTimes(2);

    vi.stubGlobal('navigator', {}); // iPhone: no vibration at all
    expect(() => haptic('tap')).not.toThrow();
  });
});
