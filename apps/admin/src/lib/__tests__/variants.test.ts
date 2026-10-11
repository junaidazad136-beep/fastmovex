import { describe, expect, it } from 'vitest';
import { combinations, emptyVariant, toVariantInputs, variantKey, variantLabel } from '@/components/products/VariantsBuilder';

describe('options builder', () => {
  it('makes every combination of option values', () => {
    const c = combinations([{ name: 'Colour', values: 'Black, White' }, { name: 'Size', values: 'S,M, M' }]);
    expect(c).toEqual([
      { Colour: 'Black', Size: 'S' }, { Colour: 'Black', Size: 'M' },
      { Colour: 'White', Size: 'S' }, { Colour: 'White', Size: 'M' },
    ]);
    expect(combinations([{ name: '', values: 'x' }])).toEqual([]);
    expect(variantKey({ Colour: 'Black' })).toBe('Colour=Black');
    expect(variantLabel({ Colour: 'Black', Size: 'M' })).toBe('Black / M');
    expect(variantLabel({})).toBe('Default');
  });

  it('checks variants before they are sent', () => {
    const v = { ...emptyVariant(), sku: 'KET-1', price: '89', compareAt: '99', stock: '5', weight: '900' };
    const ok = toVariantInputs([v]);
    expect(ok).toEqual({ ok: true, value: [expect.objectContaining({ sku: 'KET-1', priceMinor: '8900', compareAtMinor: '9900', initialStock: 5, weightGrams: 900 })] });

    expect(toVariantInputs([{ ...v, sku: '' }])).toMatchObject({ ok: false });
    expect(toVariantInputs([{ ...v, price: '' }])).toMatchObject({ ok: false, error: expect.stringContaining('price') });
    expect(toVariantInputs([{ ...v, compareAt: '80' }])).toMatchObject({ ok: false, error: expect.stringContaining('higher') });
    expect(toVariantInputs([v, { ...v, key: 'b' }])).toMatchObject({ ok: false, error: expect.stringContaining('twice') });
    expect(toVariantInputs([{ ...v, barcode: 'x' }])).toMatchObject({ ok: false, error: expect.stringContaining('barcode') });
    expect(toVariantInputs([])).toMatchObject({ ok: false });
  });
});
