import { Injectable } from '@nestjs/common';
import { LedgerAccountType, Prisma } from '@prisma/client';
import { sum } from '../pricing/money-math';
import { PrismaService } from '../prisma/prisma.service';

export interface EntryInput {
  type: LedgerAccountType;
  sellerId?: string | null;
  amountMinor: bigint; // + credit (owed to / earned by), - debit (cash in, expense)
}

export interface PostInput {
  type: string; // ORDER_CAPTURED, SELLER_RELEASE, REFUND, PAYOUT, ADJUSTMENT
  refType: string;
  refId: string;
  idempotencyKey: string;
  currencyCode: string;
  description?: string;
  actorId?: string;
  entries: EntryInput[];
}

/**
 * Double-entry ledger. Every money movement is written here once, immutably (DB triggers block UPDATE/DELETE
 * and reject unbalanced transactions). Balances are ALWAYS the sum of entries — never a column someone can edit.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(input: PostInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const entries = input.entries.filter((e) => e.amountMinor !== 0n);
    if (!entries.length) return null;
    const balance = sum(entries.map((e) => e.amountMinor));
    if (balance !== 0n) throw new Error(`Ledger transaction ${input.type} is unbalanced by ${balance}`);

    // Replaying the same event (webhook retry, retried job) must not double-post
    const existing = await db.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
    if (existing) return existing;

    const accountIds = new Map<string, string>();
    for (const e of entries) {
      const key = `${e.type}:${e.sellerId ?? ''}`;
      if (accountIds.has(key)) continue;
      accountIds.set(key, await this.accountId(db, e.type, e.sellerId ?? null, input.currencyCode));
    }

    return db.ledgerTransaction.create({
      data: {
        type: input.type, refType: input.refType, refId: input.refId, idempotencyKey: input.idempotencyKey,
        description: input.description, actorId: input.actorId,
        entries: { create: entries.map((e) => ({ accountId: accountIds.get(`${e.type}:${e.sellerId ?? ''}`)!, amountMinor: e.amountMinor })) },
      },
      select: { id: true },
    });
  }

  /** Balance of one account = SUM(entries). Never cached, never stored. */
  async balance(type: LedgerAccountType, currencyCode: string, sellerId?: string): Promise<bigint> {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { type, sellerId: sellerId ?? null, currencyCode }, select: { id: true } });
    if (!account) return 0n;
    const agg = await this.prisma.ledgerEntry.aggregate({ where: { accountId: account.id }, _sum: { amountMinor: true } });
    return agg._sum.amountMinor ?? 0n;
  }

  /** Platform accounts have sellerId = NULL, which Postgres treats as distinct — so find-then-create, guarded by a partial unique index. */
  private async accountId(db: Prisma.TransactionClient | PrismaService, type: LedgerAccountType, sellerId: string | null, currencyCode: string): Promise<string> {
    const found = await db.ledgerAccount.findFirst({ where: { type, sellerId, currencyCode }, select: { id: true } });
    if (found) return found.id;
    try {
      const created = await db.ledgerAccount.create({ data: { type, sellerId, currencyCode }, select: { id: true } });
      return created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await db.ledgerAccount.findFirstOrThrow({ where: { type, sellerId, currencyCode }, select: { id: true } });
        return raced.id;
      }
      throw err;
    }
  }

  async sellerBalances(sellerId: string, currencyCode: string) {
    const [pending, available, paid] = await Promise.all([
      this.balance('SELLER_PENDING', currencyCode, sellerId),
      this.balance('SELLER_AVAILABLE', currencyCode, sellerId),
      this.balance('SELLER_PAID', currencyCode, sellerId),
    ]);
    return { pendingMinor: pending, availableMinor: available, paidOutMinor: paid, currencyCode };
  }
}
