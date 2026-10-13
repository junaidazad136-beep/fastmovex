import { BadRequestException } from '@nestjs/common';
import { hasSizeOption, parseSizeTable, pickSizeChart, toSizeChart } from '../src/size-charts/size-chart';

const cols = [{ label: 'Size', labelAr: 'المقاس', unit: null }, { label: 'Chest', labelAr: 'الصدر', unit: 'cm' }];

describe('size chart table', () => {
  it('accepts a table and trims it', () => {
    const t = parseSizeTable([{ label: ' Size ', labelAr: '', unit: '' }, { label: 'Chest', labelAr: 'الصدر', unit: 'cm' }], [[' M ', '97–102'], ['L', 107]]);
    expect(t.columns).toEqual([{ label: 'Size', labelAr: null, unit: null }, { label: 'Chest', labelAr: 'الصدر', unit: 'cm' }]);
    expect(t.rows).toEqual([['M', '97–102'], ['L', '107']]);
  });
  it('refuses broken tables with a readable message', () => {
    const bad = (c: unknown, r: unknown) => expect(() => parseSizeTable(c, r)).toThrow(BadRequestException);
    bad([cols[0]], [['M']]); // one column
    bad(cols, []); // no rows
    bad(cols, [['M']]); // wrong cell count
    bad(cols, [['', '97']]); // no size
    bad([cols[0], { label: '', unit: null }], [['M', '1']]); // unnamed column
    bad([cols[0], { label: 'Chest', unit: 'mm' }], [['M', '1']]); // unknown unit
    bad(cols, [['M', 'x'.repeat(25)]]); // cell too long
    bad(Array.from({ length: 9 }, (_, i) => ({ label: `C${i}` })), [Array(9).fill('1')]); // too many columns
    bad(cols, Array.from({ length: 41 }, () => ['M', '1'])); // too many rows
  });
  it('drops malformed stored charts instead of showing them broken', () => {
    const row = { id: 'c1', name: 'Shoes', nameAr: 'أحذية', kind: 'SHOES', columns: cols, rows: [['42', '26.5']], note: null, noteAr: null };
    expect(toSizeChart(row)?.rows).toEqual([['42', '26.5']]);
    expect(toSizeChart({ ...row, kind: 'WHATEVER' })?.kind).toBe('GENERAL');
    expect(toSizeChart({ ...row, rows: 'nope' })).toBeNull();
  });
});

describe('which guide a product shows', () => {
  it('finds size options in English and Arabic', () => {
    expect(hasSizeOption(['Colour', 'Size'])).toBe(true);
    expect(hasSizeOption(['Shoe size'])).toBe(true);
    expect(hasSizeOption(['المقاس'])).toBe(true);
    expect(hasSizeOption(['Colour', 'Storage'])).toBe(false);
  });
  it("the product's own guide wins; a category default only when the product comes in sizes; nearest category first", () => {
    expect(pickSizeChart('own', ['cat'], [])).toBe('own');
    expect(pickSizeChart(null, ['cat'], ['Colour'])).toBeNull();
    expect(pickSizeChart(null, [null, 'parent', 'top'], ['Size'])).toBe('parent');
    expect(pickSizeChart(null, [null, null], ['Size'])).toBeNull();
  });
});
