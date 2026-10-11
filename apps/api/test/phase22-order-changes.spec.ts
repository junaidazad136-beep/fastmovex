import { BadRequestException } from '@nestjs/common';
import { localDay } from '../src/delivery/returns-logistics';
import { withinRefundLimit } from '../src/finance/refunds.service';
import { addressLine, CUSTOMER_EDITABLE, scaleLine, STAFF_EDITABLE } from '../src/orders/order-changes';

const line = { unitPriceMinor: 4000n, quantity: 3, discountMinor: 1000n, taxMinor: 0n, lineTotalMinor: 11000n, commissionMinor: 1200n };

describe('Phase 22 — reducing an order line', () => {
  it('keeps the share of discount and commission for what is kept; the removed part takes the rounding', () => {
    const r = scaleLine(line, 1, true);
    expect(r.kept).toEqual({ quantity: 1, discountMinor: 333n, taxMinor: 0n, commissionMinor: 400n, lineTotalMinor: 3667n });
    expect(r.removed).toEqual({ subtotalMinor: 8000n, discountMinor: 667n, taxMinor: 0n, commissionMinor: 800n, totalMinor: 7333n });
    // parts always add back up to the original line
    expect(r.kept.lineTotalMinor + r.removed.totalMinor).toBe(line.lineTotalMinor);
    expect(r.kept.discountMinor + r.removed.discountMinor).toBe(line.discountMinor);
  });
  it('VAT on top (prices without VAT) is part of the line total and shrinks with it', () => {
    const ex = { unitPriceMinor: 1000n, quantity: 2, discountMinor: 0n, taxMinor: 100n, lineTotalMinor: 2100n, commissionMinor: 0n };
    const r = scaleLine(ex, 1, false);
    expect(r.kept.lineTotalMinor).toBe(1050n);
    expect(r.removed).toMatchObject({ taxMinor: 50n, totalMinor: 1050n });
  });
  it('removing everything takes the whole line; out-of-range quantities are refused', () => {
    expect(scaleLine(line, 0, true).removed.totalMinor).toBe(11000n);
    expect(() => scaleLine(line, 4, true)).toThrow(BadRequestException);
    expect(() => scaleLine(line, -1, true)).toThrow(BadRequestException);
    expect(() => scaleLine(line, 1.5, true)).toThrow(BadRequestException);
  });
  it('staff may change until the driver picks it up; customers only until packing is done', () => {
    expect(STAFF_EDITABLE).toEqual(['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);
    expect(CUSTOMER_EDITABLE).toEqual(['CONFIRMED', 'PREPARING']);
  });
});

describe('Phase 22 — helpers', () => {
  it('one-line address for change summaries', () => {
    expect(addressLine({ unit: 'Flat 4', zone: '66', street: '901', building: '12', city: 'Doha' })).toBe('Flat 4, Zone 66, Street 901, Building 12, Doha');
    expect(addressLine(null)).toBe('—');
  });
  it('refund approval limit: none = any amount; otherwise up to and including the limit', () => {
    expect(withinRefundLimit(10_000_000n, null)).toBe(true);
    expect(withinRefundLimit(50_000n, 50_000n)).toBe(true);
    expect(withinRefundLimit(50_001n, 50_000n)).toBe(false);
  });
  it('pickup days are Qatar calendar days', () => {
    expect(localDay(new Date('2026-10-05T22:30:00Z'), 180)).toBe('2026-10-06');
    expect(localDay(new Date('2026-10-05T20:59:00Z'), 180)).toBe('2026-10-05');
  });
});
