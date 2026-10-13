import { describe, expect, it } from 'vitest';
import { SIZE_OPTION, convertCell, hasUnits, rowFor } from '../size-chart';

describe('size guide', () => {
  it('switches every number in a cell between cm and inches', () => {
    expect(convertCell('97–102', 'cm', 'in')).toBe('38.2–40.2');
    expect(convertCell('22.5', 'cm', 'in')).toBe('8.9');
    expect(convertCell('56', 'in', 'cm')).toBe('142');
    expect(convertCell('150–155', 'cm', 'cm')).toBe('150–155');
    expect(convertCell('M', null, 'in')).toBe('M');
  });
  it('highlights the size the shopper picked', () => {
    const chart = { rows: [['S'], ['M'], ['EU 42'], ['56']] };
    expect(rowFor(chart, 'm')).toBe(1);
    expect(rowFor(chart, '42')).toBe(2);
    expect(rowFor(chart, '56')).toBe(3);
    expect(rowFor(chart, 'XL')).toBe(-1);
    expect(rowFor(chart, undefined)).toBe(-1);
  });
  it('knows when there is anything to switch and which option is the size', () => {
    expect(hasUnits({ columns: [{ label: 'Size', labelAr: null, unit: null }, { label: 'Chest', labelAr: null, unit: 'cm' }] })).toBe(true);
    expect(hasUnits({ columns: [{ label: 'EU', labelAr: null, unit: null }] })).toBe(false);
    expect(['Size', 'Shoe size', 'المقاس'].every((n) => SIZE_OPTION.test(n))).toBe(true);
    expect(SIZE_OPTION.test('Colour')).toBe(false);
  });
});
