import { describe, expect, it } from 'vitest';
import { decimalToMinor, formatMoney, minorToDecimalString, percentOff } from '../money';

describe('money (minor units, never floats)', () => {
  it('converts minor units to exact decimal strings', () => {
    expect(minorToDecimalString('10000')).toBe('100.00');
    expect(minorToDecimalString('7')).toBe('0.07');
    expect(minorToDecimalString('-150')).toBe('-1.50');
    expect(minorToDecimalString('123456', 3)).toBe('123.456'); // KWD/BHD/OMR have 3 decimals
    expect(minorToDecimalString('500', 0)).toBe('500');
    expect(minorToDecimalString('900719925474099312')).toBe('9007199254740993.12'); // beyond float precision
  });

  it('formats QAR for English and Arabic shoppers', () => {
    expect(formatMoney('123450', 'QAR', 'en')).toBe('QAR 1,234.50');
    expect(formatMoney('7900', 'QAR', 'en', { compact: true })).toBe('QAR 79');
    expect(formatMoney('7950', 'QAR', 'en', { compact: true })).toBe('QAR 79.50'); // never hides non-zero fils
    const ar = formatMoney('123450', 'QAR', 'ar');
    expect(ar).toContain('1,234.50'); // Latin digits in Arabic too
    expect(ar).toContain('ر.ق');
    expect(formatMoney(null, 'QAR', 'en')).toBe('');
  });

  it('parses what shoppers type into minor units', () => {
    expect(decimalToMinor('150')).toBe('15000');
    expect(decimalToMinor('150.5')).toBe('15050');
    expect(decimalToMinor(' 99,90 ')).toBe('9990');
    expect(decimalToMinor('١٥٠')).toBe('15000'); // Arabic-Indic digits
    expect(decimalToMinor('1.234')).toBeNull(); // more precision than the currency has
    expect(decimalToMinor('-5')).toBeNull();
    expect(decimalToMinor('abc')).toBeNull();
    expect(decimalToMinor('1e5')).toBeNull();
  });

  it('computes whole-percent discounts with integers', () => {
    expect(percentOff('7900', '9900')).toBe(20);
    expect(percentOff('9900', '9900')).toBe(0);
    expect(percentOff('9900', '7900')).toBe(0);
    expect(percentOff('100', null)).toBe(0);
  });
});
