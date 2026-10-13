import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PayoutStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { Env } from '../config/env';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_PAYOUT: PayoutStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSING'];
const s = (v: bigint) => v.toString();

@Injectable()
export class PayoutsService {
  private readonly minPayout: bigint;
  private readonly logger = new Logger('Payouts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    this.minPayout = BigInt(String(config.get('PAYOUT_MIN_MINOR', { infer: true }) ?? '5000'));
  }

  private async currencyOf(countryCode: string) {
    return (await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode }, select: { currencyCode: true } })).currencyCode;
  }

  private async openPayoutsTotal(sellerId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const agg = await db.sellerPayout.aggregate({ where: { sellerId, status: { in: OPEN_PAYOUT } }, _sum: { amountMinor: true } });
    return agg._sum.amountMinor ?? 0n;
  }

  /** Balances come from the ledger. "Requestable" = available minus payouts already requested. */
  async balance(seller: SellerContext) {
    const currencyCode = await this.currencyOf(seller.countryCode);
    const b = await this.ledger.sellerBalances(seller.id, currencyCode);
    const open = await this.openPayoutsTotal(seller.id);
    const requestable = b.availableMinor - open > 0n ? b.availableMinor - open : 0n;
    return {
      currencyCode,
      pendingMinor: s(b.pendingMinor), // inside the return window
      availableMinor: s(b.availableMinor),
      inPayoutMinor: s(open),
      requestableMinor: s(requestable),
      paidOutMinor: s(b.paidOutMinor),
      minimumPayoutMinor: s(this.minPayout),
    };
  }

  /** The seller's own ledger lines — full transparency on every dirham. */
  async statement(seller: SellerContext, cursor?: string) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { account: { sellerId: seller.id }, ...afterCursor(decodeCursor(cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true, amountMinor: true, createdAt: true,
        account: { select: { type: true, currencyCode: true } },
        transaction: { select: { type: true, refType: true, refId: true, description: true } },
      },
    });
    const page = toPage(rows, 50);
    return { nextCursor: page.nextCursor, items: page.items.map((r) => ({ ...r, amountMinor: s(r.amountMinor) })) };
  }

  async request(seller: SellerContext, amountMinor: bigint, actorId: string | null) {
    if (amountMinor < this.minPayout) throw new BadRequestException(`Minimum payout is ${this.minPayout} (minor units)`);
    const s0 = await this.prisma.seller.findUniqueOrThrow({ where: { id: seller.id }, select: { ibanLast4: true } });
    if (!s0.ibanLast4) throw new BadRequestException('Add your bank account (IBAN) before requesting a payout');
    const currencyCode = await this.currencyOf(seller.countryCode);

    const payout = await this.prisma.$transaction(async (tx) => {
      // One request at a time per seller: two parallel taps cannot both pass the balance check
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout:' + seller.id}))`;
      const available = await this.ledger.balance('SELLER_AVAILABLE', currencyCode, seller.id);
      const open = await this.openPayoutsTotal(seller.id, tx);
      if (amountMinor > available - open) throw new BadRequestException(`You can request at most ${available - open > 0n ? available - open : 0n} (minor units)`);
      return tx.sellerPayout.create({ data: { sellerId: seller.id, amountMinor, currencyCode, status: 'REQUESTED' } });
    });
    await this.audit.log({ actorId, action: 'payout.request', entityType: 'SellerPayout', entityId: payout.id, after: { amountMinor: s(amountMinor) } });
    return { ...payout, amountMinor: s(payout.amountMinor) };
  }

  /**
   * Weekly payout run (Sunday 07:00 Qatar): every approved marketplace seller with a bank account gets a payout
   * request for all the money that is ready (past the return window), so sellers are paid every week without asking.
   * Finance still approves and marks each one paid (two people). Sellers with an open request are left alone.
   */
  @Cron('0 4 * * 0', { name: 'weekly-payouts' })
  async weeklyRequests(): Promise<{ requested: number; skipped: number }> {
    if (process.env.PAYOUT_AUTO_WEEKLY === 'off') return { requested: 0, skipped: 0 };
    const sellers = await this.prisma.seller.findMany({
      where: { status: 'APPROVED', isHouse: false, ibanLast4: { not: null }, payouts: { none: { status: { in: OPEN_PAYOUT } } } },
      select: { id: true, status: true, countryCode: true },
      take: 5000,
    });
    let requested = 0;
    let skipped = 0;
    for (const sel of sellers) {
      try {
        const b = await this.balance({ id: sel.id, status: sel.status, countryCode: sel.countryCode } as SellerContext);
        const amount = BigInt(b.requestableMinor);
        if (amount < this.minPayout) { skipped++; continue; }
        await this.request({ id: sel.id, status: sel.status, countryCode: sel.countryCode } as SellerContext, amount, null);
        requested++;
      } catch (e) {
        skipped++;
        this.logger.warn(`weekly payout for seller ${sel.id} skipped: ${(e as Error).message}`);
      }
    }
    if (requested) this.logger.log(`weekly payouts: ${requested} requested, ${skipped} skipped`);
    return { requested, skipped };
  }

  async listForSeller(sellerId: string) {
    const rows = await this.prisma.sellerPayout.findMany({ where: { sellerId }, orderBy: { requestedAt: 'desc' }, take: 100 });
    return rows.map((p) => ({ ...p, amountMinor: s(p.amountMinor) }));
  }

  async listForAdmin(status?: PayoutStatus) {
    const rows = await this.prisma.sellerPayout.findMany({
      where: { status },
      orderBy: { requestedAt: 'asc' }, // oldest first: pay in order
      take: 100,
      include: { seller: { select: { businessName: true, bankName: true, accountHolder: true, ibanLast4: true, status: true } } },
    });
    return rows.map((p) => ({ ...p, amountMinor: s(p.amountMinor) }));
  }

  async approve(id: string, admin: AuthUser) {
    const p = await this.mustGet(id);
    if (p.status !== 'REQUESTED') throw new BadRequestException(`Payout is ${p.status.toLowerCase()}`);
    const seller = await this.prisma.seller.findUniqueOrThrow({ where: { id: p.sellerId }, select: { status: true } });
    if (seller.status !== 'APPROVED') throw new BadRequestException('Seller account is not active');
    await this.prisma.sellerPayout.update({ where: { id }, data: { status: 'APPROVED', approvedById: admin.id, approvedAt: new Date() } });
    await this.audit.log({ actorId: admin.id, action: 'payout.approve', entityType: 'SellerPayout', entityId: id });
    return this.mustGet(id);
  }

  async reject(id: string, admin: AuthUser, reason: string) {
    const res = await this.prisma.sellerPayout.updateMany({ where: { id, status: { in: ['REQUESTED', 'APPROVED'] } }, data: { status: 'REJECTED', rejectionReason: reason } });
    if (res.count !== 1) throw new BadRequestException('Only requested or approved payouts can be rejected');
    await this.audit.log({ actorId: admin.id, action: 'payout.reject', entityType: 'SellerPayout', entityId: id, after: { reason } });
    return this.mustGet(id);
  }

  /**
   * Bank transfer is done -> record it. Four-eyes rule: the person who approved cannot also mark it paid
   * (SUPER_ADMIN excepted for very small teams). Balance is re-checked because refunds may have happened meanwhile.
   */
  async markPaid(id: string, admin: AuthUser, bankReference: string) {
    const p = await this.mustGet(id);
    if (p.status !== 'APPROVED' && p.status !== 'PROCESSING') throw new BadRequestException('Only approved payouts can be marked as paid');
    if (p.approvedById === admin.id && !admin.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('A different finance admin must confirm the payment (four-eyes rule)');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout:' + p.sellerId}))`;
      const available = await this.ledger.balance('SELLER_AVAILABLE', p.currencyCode, p.sellerId);
      if (p.amountMinor > available) throw new BadRequestException('Seller balance is now lower than this payout (a refund happened). Reject and ask for a new request.');
      const ltx = await this.ledger.post(
        {
          type: 'PAYOUT', refType: 'SellerPayout', refId: id, idempotencyKey: `payout_${id}`, currencyCode: p.currencyCode,
          description: `Bank transfer ${bankReference}`, actorId: admin.id,
          entries: [
            { type: 'SELLER_AVAILABLE', sellerId: p.sellerId, amountMinor: -p.amountMinor },
            { type: 'SELLER_PAID', sellerId: p.sellerId, amountMinor: p.amountMinor },
          ],
        },
        tx,
      );
      await tx.sellerPayout.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), bankReference, ledgerTransactionId: ltx?.id } });
    });
    await this.audit.log({ actorId: admin.id, action: 'payout.paid', entityType: 'SellerPayout', entityId: id, after: { bankReference } });
    this.events?.emit(EVENTS.PAYOUT_PAID, { id });
    return this.mustGet(id);
  }

  private async mustGet(id: string) {
    const p = await this.prisma.sellerPayout.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payout not found');
    return p;
  }
}

/** Platform-wide money overview for the admin dashboard, straight from the ledger. */
@Injectable()
export class FinanceSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const balances = await this.prisma.$queryRaw<{ type: string; currencyCode: string; balance: string }[]>`
      SELECT a."type"::text AS "type", a."currencyCode", COALESCE(SUM(e."amountMinor"), 0)::text AS "balance"
      FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a."id"
      GROUP BY a."type", a."currencyCode" ORDER BY a."currencyCode", a."type"`;
    const [payouts, refunds, returns] = await Promise.all([
      this.prisma.sellerPayout.groupBy({ by: ['status'], where: { status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } }, _count: true, _sum: { amountMinor: true } }),
      this.prisma.refund.groupBy({ by: ['status'], where: { status: { in: ['PENDING', 'PROCESSING'] } }, _count: true, _sum: { amountMinor: true } }),
      this.prisma.returnRequest.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }),
    ]);
    return {
      ledger: balances,
      openPayouts: payouts.map((p) => ({ status: p.status, count: p._count, amountMinor: (p._sum.amountMinor ?? 0n).toString() })),
      openRefunds: refunds.map((r) => ({ status: r.status, count: r._count, amountMinor: (r._sum.amountMinor ?? 0n).toString() })),
      openReturns: returns,
    };
  }
}
