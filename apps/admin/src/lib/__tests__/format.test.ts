import { describe, expect, it } from 'vitest';
import { decimalToMinor, formatAddress, formatMoney, fromQatarLocalInput, minorToInput, percentOffLabel, toQatarLocalInput } from '../format';

describe('money typed by staff', () => {
  it('turns what people type into exact minor units', () => {
    expect(decimalToMinor('149.5')).toBe('14950');
    expect(decimalToMinor('1,299.00')).toBe('129900');
    expect(decimalToMinor('٥٠')).toBe('5000'); // Arabic digits
    expect(decimalToMinor('0.1')).toBe('10');
    expect(decimalToMinor('1.999')).toBeNull();
    expect(decimalToMinor('-3')).toBeNull();
    expect(decimalToMinor('abc')).toBeNull();
  });
  it('shows minor units back for editing and display', () => {
    expect(minorToInput('14950')).toBe('149.50');
    expect(minorToInput(null)).toBe('');
    expect(formatMoney('14950')).toBe('QAR\u00A0149.50');
    expect(formatMoney('15000', 'QAR', { compact: true })).toBe('QAR\u00A0150');
    expect(formatMoney(null)).toBe('—');
  });
  it('labels a deal against the normal price', () => {
    expect(percentOffLabel('10000', '8000')).toBe('−20%');
    expect(percentOffLabel('10000', '12000')).toBe('0%');
  });
});

describe('dates are entered in Qatar time', () => {
  it('round-trips a datetime-local value as UTC+3', () => {
    expect(fromQatarLocalInput('2026-10-01T09:00')).toBe('2026-10-01T06:00:00.000Z');
    expect(toQatarLocalInput('2026-10-01T06:00:00.000Z')).toBe('2026-10-01T09:00');
    expect(fromQatarLocalInput('')).toBeUndefined();
  });
});

describe('Qatar addresses', () => {
  it('prints building, street and zone the way couriers read them', () => {
    expect(formatAddress({ building: '12', street: '901', zone: '66', unit: '4', city: 'Doha' })).toEqual(['Unit 4, Building 12, Street 901, Zone 66', 'Doha']);
    expect(formatAddress(null)).toEqual([]);
  });
});

describe('two-step sign-in codes as typed', async () => {
  const { cleanCode } = await import('../format');
  it('keeps 6 digits, reads Arabic-Indic digits, drops spaces', () => {
    expect(cleanCode('١٢٣ ٤٥٦', false)).toBe('123456');
    expect(cleanCode('12 34 56 78', false)).toBe('123456');
    expect(cleanCode('۹۸۷۶۵۴', false)).toBe('987654');
  });
  it('recovery codes: upper case, dash kept, at most 9 characters', () => {
    expect(cleanCode('k7qm-2xpa', true)).toBe('K7QM-2XPA');
    expect(cleanCode('k7qm 2xpa!!zz', true)).toBe('K7QM2XPAZ');
  });
});
