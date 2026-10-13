import { describe, expect, it } from 'vitest';
import { photoChoices } from '@/components/products/ImagesManager';

describe('which colour a product photo shows', () => {
  it('lists each value of the first option once, linked through its first variant', () => {
    const r = photoChoices([
      { id: 'a', optionValues: { Color: 'Black', Size: 'S' } },
      { id: 'b', optionValues: { Color: 'Black', Size: 'M' } },
      { id: 'c', optionValues: { Color: 'Pink', Size: 'S' } },
    ]);
    expect(r).toEqual({ name: 'Color', choices: [{ value: 'Black', variantId: 'a' }, { value: 'Pink', variantId: 'c' }] });
  });

  it('nothing to choose for a product without options or with one value', () => {
    expect(photoChoices([{ id: 'a', optionValues: null }])).toBeNull();
    expect(photoChoices([{ id: 'a', optionValues: { Color: 'Black' } }])).toBeNull();
  });
});
