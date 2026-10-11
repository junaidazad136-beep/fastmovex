import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { buildRefundEntries, returnDeadline, returnRefundAmount } from '../src/finance/finance-math';
import { PayoutsService } from '../src/finance/payouts.service';
import { RefundsService } from '../src/finance/refunds.service';
import { ReleaseService } from '../src/finance/release.service';
import { ReturnsService } from '../src/finance/returns.service';
import { EntryInput } from '../src/ledger/ledger.service';
import { buildCaptureEntries } from '../src/ledger/order-ledger.service';
import { sum } from '../src/pricing/money-math';

const audit = { log: jest.fn() };
const balanceOf = (ledger: EntryInput[], type: string, sellerId?: string) =>
  sum(ledger.filter((e) => e.type === type && (sellerId === undefined || e.sellerId === sellerId)).map((e) => e.amountMinor));

describe('refund maths', () => {
  const shipment = { sellerId: 'A', sellerNetMinor: 18000n, commissionMinor: 2000n, taxAddedMinor: 0n, reimbursementMinor: 0n, released: false };

  it('partial refund balances and is shared by seller and FastMoveX commission', () => {
    const e = buildRefundEntries({ ...shipment, refundMinor: 5000n });
    expect(sum(e.map((x) => x.amountMinor))).toBe(0n);
    expect(e.find((x) => x.type === 'SELLER_PENDING')?.amountMinor).toBe(-4500n);
    expect(e.find((x) => x.type === 'PLATFORM_REVENUE')?.amountMinor).toBe(-500n);
    expect(e.find((x) => x.type === 'CUSTOMER_CLEARING')?.amountMinor).toBe(5000n);
  });

  it('refund after release is taken from AVAILABLE', () => {
    const e = buildRefundEntries({ ...shipment, refundMinor: 1000n, released: true });
    expect(e.some((x) => x.type === 'SELLER_AVAILABLE')).toBe(true);
    expect(e.some((x) => x.type === 'SELLER_PENDING')).toBe(false);
  });

  it('cannot refund more than was paid for the shipment', () => {
    expect(() => buildRefundEntries({ ...shipment, refundMinor: 20001n })).toThrow('exceeds');
  });

  it('FastMoveX-funded promo: full refund claws back the reimbursement exactly', () => {
    const e = buildRefundEntries({ ...shipment, reimbursementMinor: 2000n, refundMinor: 20000n });
    expect(sum(e.map((x) => x.amountMinor))).toBe(0n);
    expect(e.find((x) => x.type === 'SELLER_PENDING')?.amountMinor).toBe(-20000n); // 18000 net + 2000 reimbursement
    expect(e.find((x) => x.type === 'PLATFORM_DISCOUNT')?.amountMinor).toBe(2000n);
  });

  it('VAT added on top is reversed too', () => {
    const e = buildRefundEntries({ ...shipment, taxAddedMinor: 1000n, refundMinor: 21000n });
    expect(e.find((x) => x.type === 'TAX_PAYABLE')?.amountMinor).toBe(-1000n);
    expect(sum(e.map((x) => x.amountMinor))).toBe(0n);
  });

  it('returning units one by one refunds EXACTLY the line total', () => {
    const parts = [returnRefundAmount(10000n, 3, 0, 1), returnRefundAmount(10000n, 3, 1, 1), returnRefundAmount(10000n, 3, 2, 1)];
    expect(parts).toEqual([3333n, 3333n, 3334n]);
    expect(sum(parts)).toBe(10000n);
    expect(() => returnRefundAmount(10000n, 3, 2, 2)).toThrow();
  });

  it('return deadline uses product policy, else seller default', () => {
    const d = new Date('2026-09-01T00:00:00Z');
    expect(returnDeadline(d, 7, 14).toISOString()).toBe('2026-09-08T00:00:00.000Z');
    expect(returnDeadline(d, null, 14).toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });
});

describe('full money lifecycle (two sellers, one refund, one payout) stays balanced', () => {
  it('capture -> refund -> release -> payout: every account adds up', () => {
    const ledger: EntryInput[] = [];
    // Order: seller A goods 200 + delivery 10, commission 20; seller B goods 100, commission 12
    ledger.push(...buildCaptureEntries({
      totalMinor: 31000n, taxMinor: 0n, taxInclusive: true, platformFundedDiscountMinor: 0n,
      sellers: [
        { sellerId: 'A', sellerNetMinor: 19000n, commissionMinor: 2000n, discountMinor: 0n },
        { sellerId: 'B', sellerNetMinor: 8800n, commissionMinor: 1200n, discountMinor: 0n },
      ],
    }));
    // B's item refunded in full before release
    ledger.push(...buildRefundEntries({ refundMinor: 10000n, sellerId: 'B', sellerNetMinor: 8800n, commissionMinor: 1200n, taxAddedMinor: 0n, reimbursementMinor: 0n, released: false }));
    // A released after the return window
    ledger.push({ type: 'SELLER_PENDING', sellerId: 'A', amountMinor: -19000n }, { type: 'SELLER_AVAILABLE', sellerId: 'A', amountMinor: 19000n });
    // A withdraws 150
    ledger.push({ type: 'SELLER_AVAILABLE', sellerId: 'A', amountMinor: -15000n }, { type: 'SELLER_PAID', sellerId: 'A', amountMinor: 15000n });

    expect(sum(ledger.map((e) => e.amountMinor))).toBe(0n); // books balance
    expect(balanceOf(ledger, 'SELLER_AVAILABLE', 'A')).toBe(4000n);
    expect(balanceOf(ledger, 'SELLER_PAID', 'A')).toBe(15000n);
    expect(balanceOf(ledger, 'SELLER_PENDING', 'B')).toBe(0n); // fully refunded -> B earns nothing
    expect(balanceOf(ledger, 'PLATFORM_REVENUE')).toBe(2000n); // only A's commission remains
    expect(balanceOf(ledger, 'CUSTOMER_CLEARING')).toBe(-21000n); // 310 in, 100 back
  });
});

describe('ReleaseService', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const so = (deliveredAt: string) => ({
    id: 'so1', orderId: 'o1', sellerId: 'A', deliveredAt: new Date(deliveredAt),
    seller: { returnWindowDays: 14 }, order: { currencyCode: 'QAR' }, items: [{ variant: { product: { returnPolicyDays: null } } }],
  });
  function build(candidate: object, captured: bigint | null, refunded = 0n) {
    const tx = { $executeRaw: jest.fn(), sellerOrder: { findUnique: jest.fn().mockResolvedValue({ releasedAt: null }), update: jest.fn() } };
    const prisma = { sellerOrder: { findMany: jest.fn().mockResolvedValue([candidate]) }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const ledger = { post: jest.fn() };
    const query = { capturedForSeller: jest.fn().mockResolvedValue(captured), refundedFromSeller: jest.fn().mockResolvedValue(refunded) };
    return { svc: new ReleaseService(prisma as never, ledger as never, query as never), ledger, tx };
  }

  it('does not release inside the return window', async () => {
    const { svc, ledger } = build(so('2026-09-25T00:00:00Z'), 19000n);
    await expect(svc.releaseDue(now)).resolves.toEqual({ released: 0, skipped: 1 });
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('releases captured minus refunded, once (idempotency key per shipment)', async () => {
    const { svc, ledger, tx } = build(so('2026-09-01T00:00:00Z'), 19000n, 4000n);
    await expect(svc.releaseDue(now)).resolves.toEqual({ released: 1, skipped: 0 });
    const posted = ledger.post.mock.calls[0][0];
    expect(posted.idempotencyKey).toBe('release_so1');
    expect(posted.entries).toEqual([
      { type: 'SELLER_PENDING', sellerId: 'A', amountMinor: -15000n },
      { type: 'SELLER_AVAILABLE', sellerId: 'A', amountMinor: 15000n },
    ]);
    expect(tx.sellerOrder.update).toHaveBeenCalled();
  });

  it('waits when the payment is not captured yet (COD in transit)', async () => {
    const { svc, ledger } = build(so('2026-09-01T00:00:00Z'), null);
    await expect(svc.releaseDue(now)).resolves.toEqual({ released: 0, skipped: 1 });
    expect(ledger.post).not.toHaveBeenCalled();
  });
});

describe('PayoutsService', () => {
  const seller = { id: 'A', status: 'APPROVED', countryCode: 'QA' };
  const config = { get: () => '5000' };
  function build(o: { available?: bigint; open?: bigint; iban?: string | null; payout?: object } = {}) {
    const tx = { $executeRaw: jest.fn(), sellerPayout: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: o.open ?? 0n } }), create: jest.fn().mockResolvedValue({ id: 'p1', amountMinor: 6000n }), update: jest.fn() } };
    const prisma = {
      seller: { findUniqueOrThrow: jest.fn().mockResolvedValue({ ibanLast4: o.iban === undefined ? '1234' : o.iban, status: 'APPROVED' }) },
      country: { findUniqueOrThrow: jest.fn().mockResolvedValue({ currencyCode: 'QAR' }) },
      sellerPayout: { findUnique: jest.fn().mockResolvedValue(o.payout ?? null), aggregate: tx.sellerPayout.aggregate },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    const ledger = { balance: jest.fn().mockResolvedValue(o.available ?? 0n), post: jest.fn().mockResolvedValue({ id: 'ltx' }), sellerBalances: jest.fn() };
    return { svc: new PayoutsService(prisma as never, ledger as never, audit as never, config as never), tx, ledger };
  }

  it('below the minimum payout -> 400', async () => {
    await expect(build({ available: 100000n }).svc.request(seller, 1000n, 'u')).rejects.toThrow('Minimum payout');
  });
  it('no bank account -> 400', async () => {
    await expect(build({ available: 100000n, iban: null }).svc.request(seller, 6000n, 'u')).rejects.toThrow('bank account');
  });
  it('cannot request more than available minus open requests', async () => {
    await expect(build({ available: 10000n, open: 5000n }).svc.request(seller, 6000n, 'u')).rejects.toThrow('at most 5000');
  });
  it('valid request is created under a per-seller lock', async () => {
    const { svc, tx } = build({ available: 10000n });
    await svc.request(seller, 6000n, 'u');
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.sellerPayout.create).toHaveBeenCalled();
  });

  const approved = { id: 'p1', sellerId: 'A', amountMinor: 6000n, currencyCode: 'QAR', status: 'APPROVED', approvedById: 'fin-1' };
  it('four-eyes: approver cannot also mark it paid', async () => {
    await expect(build({ payout: approved, available: 10000n }).svc.markPaid('p1', { id: 'fin-1', roles: ['FINANCE_ADMIN'], permissions: [] }, 'TRF-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('balance is re-checked at payment time', async () => {
    await expect(build({ payout: approved, available: 5000n }).svc.markPaid('p1', { id: 'fin-2', roles: ['FINANCE_ADMIN'], permissions: [] }, 'TRF-1')).rejects.toThrow('lower than this payout');
  });
  it('paying posts AVAILABLE -> PAID in the ledger', async () => {
    const { svc, ledger } = build({ payout: approved, available: 10000n });
    await svc.markPaid('p1', { id: 'fin-2', roles: ['FINANCE_ADMIN'], permissions: [] }, 'TRF-1');
    expect(ledger.post.mock.calls[0][0]).toMatchObject({ type: 'PAYOUT', idempotencyKey: 'payout_p1' });
    expect(sum(ledger.post.mock.calls[0][0].entries.map((e: EntryInput) => e.amountMinor))).toBe(0n);
  });
});

describe('RefundsService', () => {
  it('two admins approving at once: only one wins', async () => {
    const prisma = { refund: { findUnique: jest.fn().mockResolvedValue({ createdById: 'support-1', amountMinor: 100n, payment: { currencyCode: 'QAR' } }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, user: { findUnique: jest.fn().mockResolvedValue({ refundLimitMinor: null }) } };
    const svc = new RefundsService(prisma as never, {} as never, {} as never, {} as never, audit as never);
    await expect(svc.approve('r1', { id: 'fin-1', roles: ['FINANCE_ADMIN'] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('four-eyes: whoever created a refund cannot approve or pay it; a super admin may', async () => {
    const prisma = { refund: { findUnique: jest.fn().mockResolvedValue({ createdById: 'fin-1', amountMinor: 100n, payment: { currencyCode: 'QAR' } }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, user: { findUnique: jest.fn().mockResolvedValue({ refundLimitMinor: null }) } };
    const svc = new RefundsService(prisma as never, {} as never, {} as never, {} as never, audit as never);
    await expect(svc.approve('r1', { id: 'fin-1', roles: ['FINANCE_ADMIN'] })).rejects.toThrow('different person');
    await expect(svc.markPaid('r1', { id: 'fin-1', roles: ['FINANCE_ADMIN'] }, 'TRF-1')).rejects.toThrow('different person');
    expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    await expect(svc.approve('r1', { id: 'fin-1', roles: ['SUPER_ADMIN'] })).rejects.toBeInstanceOf(ConflictException); // allowed through, then nothing pending
  });

  it('manual refund cannot exceed what is left on the shipment', async () => {
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue({ id: 'o1' }) },
      sellerOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'so1', orderId: 'o1', subtotalMinor: 10000n, discountMinor: 0n, deliveryFeeMinor: 0n, taxMinor: 0n, order: { countryCode: 'QA' } }) },
      country: { findUnique: jest.fn().mockResolvedValue({ pricesIncludeTax: true }) },
      refund: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 8000n } }) },
    };
    const svc = new RefundsService(prisma as never, {} as never, {} as never, {} as never, audit as never);
    await expect(svc.createManual({ orderNumber: 'FMX-QA-1', sellerOrderId: 'so1', amountMinor: 3000n, reason: 'damaged' }, 'admin')).rejects.toThrow('between 1 and 2000');
  });
});

describe('ReturnsService', () => {
  const now = new Date('2026-09-20T00:00:00Z');
  const item = (o: Record<string, unknown> = {}) => ({
    id: 'i1', quantity: 2, refundedQty: 0, status: 'DELIVERED',
    sellerOrder: { deliveredAt: new Date('2026-09-15T00:00:00Z'), status: 'DELIVERED', seller: { returnWindowDays: 14 } },
    variant: { product: { returnPolicyDays: null } }, returns: [], ...o,
  });
  const make = (found: unknown) => new ReturnsService({ orderItem: { findFirst: jest.fn().mockResolvedValue(found) }, returnRequest: { findUnique: jest.fn().mockResolvedValue(found) } } as never, {} as never, audit as never);
  const input = { orderItemId: 'i1', quantity: 1, reason: 'Arrived damaged' };

  it("cannot return someone else's item", async () => {
    await expect(make(null).request('u1', 'FMX-QA-1', input, now)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('not before delivery', async () => {
    await expect(make(item({ status: 'SHIPPED', sellerOrder: { deliveredAt: null, seller: { returnWindowDays: 14 } } })).request('u1', 'FMX-QA-1', input, now)).rejects.toThrow('after the item is delivered');
  });
  it('not after the window closes', async () => {
    await expect(make(item()).request('u1', 'FMX-QA-1', input, new Date('2026-10-10T00:00:00Z'))).rejects.toThrow('window');
  });
  it('non-returnable products (policy 0 days)', async () => {
    await expect(make(item({ variant: { product: { returnPolicyDays: 0 } } })).request('u1', 'FMX-QA-1', input, now)).rejects.toThrow('not returnable');
  });
  it('cannot return more than bought (minus open returns)', async () => {
    await expect(make(item({ returns: [{ quantity: 2 }] })).request('u1', 'FMX-QA-1', input, now)).rejects.toThrow('at most 0');
  });
  it("seller cannot decide another seller's return", async () => {
    const ret = { id: 'r1', status: 'REQUESTED', orderItemId: 'i1', orderItem: { sellerOrder: { sellerId: 'B' } } };
    await expect(make(ret).decide('r1', 'APPROVED', 'u', 'A')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejecting needs a reason for the customer', async () => {
    const ret = { id: 'r1', status: 'REQUESTED', orderItemId: 'i1', orderItem: { sellerOrder: { sellerId: 'A' } } };
    await expect(make(ret).decide('r1', 'REJECTED', 'u', 'A')).rejects.toBeInstanceOf(BadRequestException);
  });
});
