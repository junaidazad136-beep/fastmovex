import { describe, expect, it } from 'vitest';
import { effectivePrice } from '@/components/product/Price';
import { defaultVariant, findVariant, isValueAvailable, optionNames, optionValues, selectValue } from '@/components/product/variants';
import type { Variant } from '../api/types';

const v = (id: string, opts: Record<string, string>, price: string, inStock = true): Variant => ({
  id, sku: id, optionValues: opts, priceMinor: price, compareAtMinor: null, currencyCode: 'QAR', discountPercent: 0, inStock, lowStockCount: null, dealPriceMinor: null, dealEndsAt: null, dealStockLeft: null,
});

describe('price shown to shoppers', () => {
  it('a live deal wins and the higher reference price is struck through', () => {
    expect(effectivePrice({ priceMinor: '9900', compareAtMinor: null, dealPriceMinor: '7900' })).toEqual({ now: '7900', was: '9900', percent: 20, onDeal: true });
    expect(effectivePrice({ priceMinor: '9900', compareAtMinor: '12900', dealPriceMinor: '7900' })).toMatchObject({ now: '7900', was: '12900', percent: 38 });
    expect(effectivePrice({ priceMinor: '7900', compareAtMinor: '9900' })).toEqual({ now: '7900', was: '9900', percent: 20, onDeal: false });
    expect(effectivePrice({ priceMinor: '7900', compareAtMinor: null, dealPriceMinor: '8900' })).toEqual({ now: '7900', was: null, percent: 0, onDeal: false }); // a "deal" that is not cheaper is ignored
  });
});

describe('variant picker', () => {
  const variants = [
    v('bk-s', { Colour: 'Black', Size: 'S' }, '100', false),
    v('bk-m', { Colour: 'Black', Size: 'M' }, '100'),
    v('wh-s', { Colour: 'White', Size: 'S' }, '110'),
  ];
  it('lists options and values in order', () => {
    expect(optionNames(variants)).toEqual(['Colour', 'Size']);
    expect(optionValues(variants, 'Size')).toEqual(['S', 'M']);
  });
  it('starts on the first in-stock variant', () => {
    expect(defaultVariant(variants)?.id).toBe('bk-m');
  });
  it('marks combinations that cannot be bought', () => {
    expect(isValueAvailable(variants, { Colour: 'Black', Size: 'M' }, 'Size', 'S')).toBe(false);
    expect(isValueAvailable(variants, { Colour: 'White', Size: 'S' }, 'Size', 'S')).toBe(true);
  });
  it('switching to a value that does not combine jumps to the closest real variant', () => {
    expect(selectValue(variants, { Colour: 'Black', Size: 'M' }, 'Colour', 'White')).toEqual({ Colour: 'White', Size: 'S' });
    expect(findVariant(variants, { Colour: 'White', Size: 'S' })?.id).toBe('wh-s');
  });
});
