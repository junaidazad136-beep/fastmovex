import { refundAfterFee, reportWindowOpen, returnFee } from '../src/finance/finance-math';

describe('return fee and 48 h window', () => {
  it('charges QAR 10 only for change of mind in QAR', () => {
    expect(returnFee('CHANGE_OF_MIND', 'QAR')).toBe(1000n);
    expect(returnFee('DEFECTIVE', 'QAR')).toBe(0n);
    expect(returnFee('WRONG_ITEM', 'QAR')).toBe(0n);
    expect(returnFee('CHANGE_OF_MIND', 'SAR')).toBe(0n);
  });
  it('never refunds below zero', () => {
    expect(refundAfterFee(5000n, 1000n)).toBe(4000n);
    expect(refundAfterFee(800n, 1000n)).toBe(0n);
    expect(refundAfterFee(1000n, 1000n)).toBe(0n);
  });
  it('48 h report window', () => {
    const d = new Date('2026-11-01T10:00:00Z');
    expect(reportWindowOpen(d, new Date('2026-11-03T09:59:00Z'))).toBe(true);
    expect(reportWindowOpen(d, new Date('2026-11-03T10:01:00Z'))).toBe(false);
  });
});
