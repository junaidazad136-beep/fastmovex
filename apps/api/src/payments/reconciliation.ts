import {
  BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { tzFor } from '../analytics/range';
import { AuditService } from '../audit/audit.service';
import { sendPdf } from '../cash/cash';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { renderDailyClosing } from '../documents/daily-closing';
import { PrismaService } from '../prisma/prisma.service';

const country = () => process.env.DEFAULT_COUNTRY ?? 'QA';
const CAPTURED = ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
const HOUR = 3_600_000;

// ====================================================================== CSV (pure, exported for tests)

/** RFC 4180-ish: commas or semicolons, quoted fields with "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
  return rows;
}

/** "1,234.50" / "1234.5" / "-12" / "QAR 99.00" → minor units (2 decimals). Null when it is not a number. */
export function amountToMinor(raw: string, decimals = 2): bigint | null {
  const s = raw.replace(/[A-Za-z\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const m = /^(-)?(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(decimals, '0');
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) return null; // more precision than the currency has
  const v = BigInt(m[2]) * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals) || '0');
  return m[1] ? -v : v;
}

const REF_HEADERS = ['reference', 'ref', 'payment id', 'payment_id', 'paymentid', 'transaction id', 'transaction_id', 'id', 'provider reference'];
const AMOUNT_HEADERS = ['amount', 'gross', 'gross amount', 'value', 'total'];
const DATE_HEADERS = ['date', 'created', 'created at', 'created_at', 'paid at', 'settled at', 'transaction date'];

export interface SettlementRow { line: number; reference: string; amountMinor: bigint; date: Date | null }

/** Finds the reference / amount (/ date) columns by header name; without a header row, column 1 is the reference and 2 the amount. */
export function readSettlement(text: string): { rows: SettlementRow[]; errors: { line: number; message: string }[] } {
  const all = parseCsv(text);
  if (!all.length) throw new BadRequestException('The file is empty');
  const head = all[0].map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const find = (names: string[]) => head.findIndex((h) => names.includes(h));
  let ref = find(REF_HEADERS);
  let amt = find(AMOUNT_HEADERS);
  const date = find(DATE_HEADERS);
  const hasHeader = ref >= 0 || amt >= 0;
  if (hasHeader && (ref < 0 || amt < 0)) throw new BadRequestException('The file needs a "reference" column and an "amount" column');
  if (!hasHeader) { ref = 0; amt = 1; }
  const rows: SettlementRow[] = [];
  const errors: { line: number; message: string }[] = [];
  all.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const reference = (r[ref] ?? '').trim();
    const amount = amountToMinor(r[amt] ?? '');
    if (!reference) return errors.push({ line, message: 'No reference' });
    if (amount === null) return errors.push({ line, message: `Amount "${r[amt] ?? ''}" is not a number` });
    const d = date >= 0 && r[date] ? new Date(r[date]) : null;
    rows.push({ line, reference, amountMinor: amount, date: d && !Number.isNaN(d.getTime()) ? d : null });
  });
  if (rows.length > 20_000) throw new BadRequestException('Up to 20,000 rows per file');
  return { rows, errors };
}

/** Start and end (exclusive) of a calendar day in the market's time zone. */
export function dayBounds(day: string, offsetMin: number): { from: Date; to: Date } {
  const start = new Date(`${day}T00:00:00.000Z`).getTime() - offsetMin * 60_000;
  return { from: new Date(start), to: new Date(start + 24 * HOUR) };
}

// ====================================================================== DTOs

const KINDS = ['CANCELLED_NOT_REFUNDED', 'DELIVERED_NOT_PAID', 'AMOUNT_MISMATCH', 'CARD_PENDING', 'COD_NO_COLLECTION', 'CASH_NOT_HANDED_OVER'] as const;
export type ExceptionKind = (typeof KINDS)[number];
class ExceptionsQuery { @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: ExceptionKind; }
class SettlementDto {
  @ApiPropertyOptional({ default: 'dibsy' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsString() @MaxLength(30) provider?: string;
}
class DayQuery { @ApiPropertyOptional({ example: '2026-10-05', description: 'Defaults to today (Qatar time)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string; }

// ====================================================================== service

export interface PaymentException {
  kind: ExceptionKind; orderNumber: string; orderStatus: string; paymentId: string | null; method: string | null; provider: string | null;
  amountMinor: string; currencyCode: string; detail: string; since: Date;
}

/**
 * Money checks finance runs every day: payments that do not line up with their orders (#11), the gateway's
 * settlement file matched against FastMoveX, and the daily closing report (#23).
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async exceptions(kind?: ExceptionKind, now = new Date()): Promise<{ counts: Record<ExceptionKind, number>; items: PaymentException[] }> {
    const want = (k: ExceptionKind) => !kind || kind === k;
    const out: PaymentException[] = [];
    const LIMIT = 200;

    if (want('CANCELLED_NOT_REFUNDED')) {
      // money taken for an order that was cancelled, and not (fully) given back or on its way back
      const rows = await this.prisma.$queryRaw<{ orderNumber: string; status: string; id: string; method: string; provider: string; amountMinor: bigint; refundedMinor: bigint; pending: bigint; currencyCode: string; since: Date }[]>`
        SELECT o."orderNumber", o.status::text AS status, p.id, p.method::text AS method, p.provider, p."amountMinor", p."refundedMinor", p."currencyCode", o."updatedAt" AS since,
               coalesce((SELECT sum(r."amountMinor") FROM "Refund" r WHERE r."paymentId" = p.id AND r.status IN ('PENDING','PROCESSING')), 0)::bigint AS pending
        FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
        WHERE o.status = 'CANCELLED' AND p.status IN ('CAPTURED','PARTIALLY_REFUNDED')
        ORDER BY o."updatedAt" DESC LIMIT ${LIMIT}`;
      for (const r of rows) {
        const owed = r.amountMinor - r.refundedMinor - r.pending;
        if (owed <= 0n) continue;
        out.push({ kind: 'CANCELLED_NOT_REFUNDED', orderNumber: r.orderNumber, orderStatus: r.status, paymentId: r.id, method: r.method, provider: r.provider, amountMinor: owed.toString(), currencyCode: r.currencyCode, detail: 'Order cancelled but the customer was charged and no refund is on its way', since: r.since });
      }
    }

    if (want('DELIVERED_NOT_PAID')) {
      const rows = await this.prisma.$queryRaw<{ orderNumber: string; status: string; id: string; method: string; provider: string; pstatus: string; amountMinor: bigint; currencyCode: string; since: Date }[]>`
        SELECT o."orderNumber", o.status::text AS status, p.id, p.method::text AS method, p.provider, p.status::text AS pstatus, o."totalMinor" AS "amountMinor", o."currencyCode", o."updatedAt" AS since
        FROM "Order" o JOIN "Payment" p ON p."orderId" = o.id
        WHERE o.status = 'DELIVERED' AND p.status IN ('PENDING','AUTHORIZED')
          AND NOT EXISTS (SELECT 1 FROM "Payment" q WHERE q."orderId" = o.id AND q.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
        ORDER BY o."updatedAt" DESC LIMIT ${LIMIT}`;
      for (const r of rows) out.push({ kind: 'DELIVERED_NOT_PAID', orderNumber: r.orderNumber, orderStatus: r.status, paymentId: r.id, method: r.method, provider: r.provider, amountMinor: r.amountMinor.toString(), currencyCode: r.currencyCode, detail: `Delivered, but the payment is still ${r.pstatus.toLowerCase()}`, since: r.since });
    }

    if (want('AMOUNT_MISMATCH')) {
      // what was taken for an order differs from what it should be: the order total for cards; for cash on delivery,
      // the shipments that were not cancelled (a cancelled shipment is never paid for at the door)
      const rows = await this.prisma.$queryRaw<{ orderNumber: string; status: string; total: bigint; paid: bigint; currencyCode: string; since: Date; method: string }[]>`
        WITH paid AS (
          SELECT p."orderId", sum(p."amountMinor")::bigint AS paid, max(p."updatedAt") AS since, bool_and(p.method = 'COD') AS cod, min(p.method::text) AS method
          FROM "Payment" p WHERE p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') GROUP BY p."orderId"
        ), live AS (
          SELECT so."orderId", sum(so."subtotalMinor" - so."discountMinor" + so."deliveryFeeMinor" + so."taxMinor")::bigint AS due
          FROM "SellerOrder" so WHERE so.status <> 'CANCELLED' GROUP BY so."orderId"
        )
        SELECT o."orderNumber", o.status::text AS status, CASE WHEN x.cod THEN coalesce(l.due, 0) ELSE o."totalMinor" END AS total,
               x.paid, o."currencyCode", x.since, x.method
        FROM paid x JOIN "Order" o ON o.id = x."orderId" LEFT JOIN live l ON l."orderId" = o.id
        WHERE x.paid <> CASE WHEN x.cod THEN coalesce(l.due, 0) ELSE o."totalMinor" END
        ORDER BY x.since DESC LIMIT ${LIMIT}`;
      for (const r of rows) {
        const diff = r.paid - r.total;
        out.push({ kind: 'AMOUNT_MISMATCH', orderNumber: r.orderNumber, orderStatus: r.status, paymentId: null, method: r.method, provider: null, amountMinor: diff.toString(), currencyCode: r.currencyCode, detail: `Taken ${diff < 0n ? 'less' : 'more'} than due (${r.paid} vs ${r.total} minor units)`, since: r.since });
      }
    }

    if (want('CARD_PENDING')) {
      const before = new Date(now.getTime() - HOUR);
      const rows = await this.prisma.payment.findMany({
        where: { method: { not: 'COD' }, status: { in: ['PENDING', 'AUTHORIZED'] }, createdAt: { lt: before }, order: { status: { notIn: ['CANCELLED'] } } },
        orderBy: { createdAt: 'asc' }, take: LIMIT,
        select: { id: true, method: true, provider: true, status: true, amountMinor: true, currencyCode: true, createdAt: true, order: { select: { orderNumber: true, status: true } } },
      });
      for (const p of rows) out.push({ kind: 'CARD_PENDING', orderNumber: p.order.orderNumber, orderStatus: p.order.status, paymentId: p.id, method: p.method, provider: p.provider, amountMinor: p.amountMinor.toString(), currencyCode: p.currencyCode, detail: `Card payment ${p.status.toLowerCase()} for over an hour — check it with the gateway`, since: p.createdAt });
    }

    if (want('COD_NO_COLLECTION')) {
      // a cash order shown as delivered, but nobody is holding the cash for it
      const rows = await this.prisma.$queryRaw<{ orderNumber: string; status: string; id: string; amountMinor: bigint; currencyCode: string; since: Date }[]>`
        SELECT o."orderNumber", so.status::text AS status, p.id, (so."subtotalMinor" - so."discountMinor" + so."deliveryFeeMinor" + so."taxMinor")::bigint AS "amountMinor", o."currencyCode", coalesce(so."deliveredAt", so."updatedAt") AS since
        FROM "SellerOrder" so JOIN "Order" o ON o.id = so."orderId" JOIN "Payment" p ON p."orderId" = o.id AND p.method = 'COD'
        WHERE so.status = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM "CodCollection" c WHERE c."sellerOrderId" = so.id)
        ORDER BY since DESC LIMIT ${LIMIT}`;
      for (const r of rows) out.push({ kind: 'COD_NO_COLLECTION', orderNumber: r.orderNumber, orderStatus: r.status, paymentId: r.id, method: 'COD', provider: 'cod', amountMinor: r.amountMinor.toString(), currencyCode: r.currencyCode, detail: 'Cash order delivered, but no cash collection is recorded', since: r.since });
    }

    if (want('CASH_NOT_HANDED_OVER')) {
      const rows = await this.prisma.codCollection.findMany({
        where: { handoverId: null, collectedAt: { lt: new Date(now.getTime() - 24 * HOUR) } }, orderBy: { collectedAt: 'asc' }, take: LIMIT,
        select: { amountMinor: true, currencyCode: true, collectedAt: true, holder: { select: { fullName: true } }, sellerOrder: { select: { status: true, order: { select: { orderNumber: true } } } } },
      });
      for (const c of rows) out.push({ kind: 'CASH_NOT_HANDED_OVER', orderNumber: c.sellerOrder.order.orderNumber, orderStatus: c.sellerOrder.status, paymentId: null, method: 'COD', provider: 'cod', amountMinor: c.amountMinor.toString(), currencyCode: c.currencyCode, detail: `Cash still with ${c.holder.fullName} for more than a day`, since: c.collectedAt });
    }

    const counts = Object.fromEntries(KINDS.map((k) => [k, out.filter((e) => e.kind === k).length])) as Record<ExceptionKind, number>;
    return { counts, items: out };
  }

  /**
   * The gateway's settlement file against FastMoveX: each row matched by reference. Matched = same amount and FastMoveX has it as
   * paid; mismatched = amount or status differs; missing = in the file but unknown to FastMoveX; extra = card payments FastMoveX
   * captured within the file's dates that the file does not have.
   */
  async settle(file: { originalname: string; buffer: Buffer } | undefined, provider: string, actor: AuthUser) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the settlement file (CSV) to upload');
    if (!/\.(csv|txt)$/i.test(file.originalname)) throw new BadRequestException('Upload the settlement report as a .csv file');
    const text = file.buffer.toString('utf8');
    if (text.includes('\u0000')) throw new BadRequestException('This does not look like a CSV file');
    const { rows, errors } = readSettlement(text);
    const refs = [...new Set(rows.map((r) => r.reference))];
    const [payments, refunds] = await Promise.all([
      this.prisma.payment.findMany({ where: { providerRef: { in: refs } }, select: { id: true, provider: true, providerRef: true, amountMinor: true, status: true, currencyCode: true, createdAt: true, order: { select: { orderNumber: true } } } }),
      this.prisma.refund.findMany({ where: { providerRef: { in: refs } }, select: { id: true, providerRef: true, amountMinor: true, status: true, order: { select: { orderNumber: true } } } }),
    ]);
    const pay = new Map(payments.map((p) => [p.providerRef!, p]));
    const ref = new Map(refunds.map((r) => [r.providerRef!, r]));
    const seen = new Set<string>();
    type Line = { line: number; reference: string; fileAmountMinor: string; shopAmountMinor: string | null; orderNumber: string | null; status: string | null; result: 'MATCHED' | 'MISMATCHED' | 'MISSING' | 'DUPLICATE'; note?: string };
    const lines: Line[] = [];
    let fileTotal = 0n;
    for (const r of rows) {
      fileTotal += r.amountMinor;
      const base = { line: r.line, reference: r.reference, fileAmountMinor: r.amountMinor.toString() };
      if (seen.has(r.reference)) { lines.push({ ...base, shopAmountMinor: null, orderNumber: null, status: null, result: 'DUPLICATE', note: 'This reference is in the file more than once' }); continue; }
      seen.add(r.reference);
      const p = pay.get(r.reference);
      const f = ref.get(r.reference);
      if (p) {
        const paid = (CAPTURED as readonly string[]).includes(p.status);
        const ok = paid && p.amountMinor === r.amountMinor;
        lines.push({ ...base, shopAmountMinor: p.amountMinor.toString(), orderNumber: p.order.orderNumber, status: p.status, result: ok ? 'MATCHED' : 'MISMATCHED', ...(!ok && { note: !paid ? `FastMoveX has this payment as ${p.status.toLowerCase()}` : 'Amounts differ' }) });
      } else if (f) {
        const ok = f.status === 'SUCCEEDED' && -f.amountMinor === r.amountMinor;
        lines.push({ ...base, shopAmountMinor: (-f.amountMinor).toString(), orderNumber: f.order.orderNumber, status: `REFUND_${f.status}`, result: ok ? 'MATCHED' : 'MISMATCHED', ...(!ok && { note: f.status !== 'SUCCEEDED' ? `Refund is ${f.status.toLowerCase()} in FastMoveX` : 'Refund amount differs (refunds should be negative)' }) });
      } else {
        lines.push({ ...base, shopAmountMinor: null, orderNumber: null, status: null, result: 'MISSING', note: 'Not found in FastMoveX' });
      }
    }
    // the file's period: its own dates, or the dates of the payments it matched
    const dates = [...rows.map((r) => r.date), ...payments.map((p) => p.createdAt)].filter((d): d is Date => !!d).map((d) => d.getTime());
    let extra: { reference: string | null; orderNumber: string; amountMinor: string; capturedAt: Date }[] = [];
    if (dates.length) {
      const from = new Date(Math.min(...dates));
      const to = new Date(Math.max(...dates) + 1000);
      const ours = await this.prisma.payment.findMany({
        where: { provider, method: { not: 'COD' }, status: { in: [...CAPTURED] }, createdAt: { gte: from, lt: to }, NOT: { providerRef: { in: refs } } },
        take: 500, orderBy: { createdAt: 'asc' },
        select: { providerRef: true, amountMinor: true, createdAt: true, order: { select: { orderNumber: true } } },
      });
      extra = ours.map((p) => ({ reference: p.providerRef, orderNumber: p.order.orderNumber, amountMinor: p.amountMinor.toString(), capturedAt: p.createdAt }));
    }
    const c = await this.prisma.country.findUnique({ where: { code: country() }, select: { currencyCode: true } });
    const tally = (k: Line['result']) => lines.filter((l) => l.result === k).length;
    const saved = await this.prisma.paymentSettlement.create({
      data: {
        provider, fileName: file.originalname.slice(0, 200), currencyCode: c?.currencyCode ?? 'QAR', rows: rows.length,
        matched: tally('MATCHED'), mismatched: tally('MISMATCHED') + tally('DUPLICATE'), missing: tally('MISSING'), extra: extra.length, fileTotalMinor: fileTotal,
        result: { lines: lines.filter((l) => l.result !== 'MATCHED'), extra, errors } as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
    });
    await this.audit.log({ actorId: actor.id, action: 'payments.settlement_uploaded', entityType: 'PaymentSettlement', entityId: saved.id, after: { file: saved.fileName, rows: saved.rows, matched: saved.matched, mismatched: saved.mismatched, missing: saved.missing, extra: saved.extra } });
    return this.settlement(saved.id);
  }

  async settlements() {
    const rows = await this.prisma.paymentSettlement.findMany({ orderBy: { createdAt: 'desc' }, take: 30, omit: { result: true } });
    return rows.map((r) => ({ ...r, fileTotalMinor: r.fileTotalMinor.toString() }));
  }

  async settlement(id: string) {
    const r = await this.prisma.paymentSettlement.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Settlement not found');
    return { ...r, fileTotalMinor: r.fileTotalMinor.toString() };
  }

  /** One day's money: sales by payment method, card money in, refunds out, cash collected / handed in / short. */
  async closing(day?: string, now = new Date()) {
    const { tz, offsetMin } = tzFor(country());
    const date = day ?? new Date(now.getTime() + offsetMin * 60_000).toISOString().slice(0, 10);
    const { from, to } = dayBounds(date, offsetMin);
    const c = await this.prisma.country.findUnique({ where: { code: country() }, select: { currencyCode: true } });
    const currencyCode = c?.currencyCode ?? 'QAR';

    const [sales, card, refunds, collected, handovers, holding, cancelled] = await Promise.all([
      this.prisma.$queryRaw<{ method: string; orders: number; totalMinor: bigint }[]>`
        SELECT coalesce((SELECT p.method::text FROM "Payment" p WHERE p."orderId" = o.id ORDER BY p."createdAt" LIMIT 1), 'NONE') AS method,
               count(*)::int AS orders, coalesce(sum(o."totalMinor"), 0)::bigint AS "totalMinor"
        FROM "Order" o WHERE o."placedAt" >= ${from} AND o."placedAt" < ${to} AND o."countryCode" = ${country()} AND o.status <> 'CANCELLED'
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ method: string; payments: number; totalMinor: bigint }[]>`
        SELECT p.method::text AS method, count(*)::int AS payments, coalesce(sum(p."amountMinor"), 0)::bigint AS "totalMinor"
        FROM "Payment" p WHERE p.method <> 'COD' AND p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND p."createdAt" >= ${from} AND p."createdAt" < ${to}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ method: string; refunds: number; totalMinor: bigint }[]>`
        SELECT p.method::text AS method, count(*)::int AS refunds, coalesce(sum(r."amountMinor"), 0)::bigint AS "totalMinor"
        FROM "Refund" r JOIN "Payment" p ON p.id = r."paymentId" WHERE r.status = 'SUCCEEDED' AND r."completedAt" >= ${from} AND r."completedAt" < ${to}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.codCollection.aggregate({ where: { collectedAt: { gte: from, lt: to } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.cashHandover.findMany({
        where: { createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'asc' },
        select: { number: true, expectedMinor: true, receivedMinor: true, varianceMinor: true, note: true, createdAt: true, holder: { select: { fullName: true } }, receivedBy: { select: { fullName: true } } },
      }),
      this.prisma.codCollection.aggregate({ where: { handoverId: null, collectedAt: { lt: to } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.order.aggregate({ where: { placedAt: { gte: from, lt: to }, countryCode: country(), status: 'CANCELLED' }, _sum: { totalMinor: true }, _count: true }),
    ]);
    const sum = (xs: { totalMinor: bigint }[]) => xs.reduce((n, x) => n + x.totalMinor, 0n);
    const cardIn = sum(card);
    const cashIn = collected._sum.amountMinor ?? 0n;
    const refundsOut = sum(refunds);
    const handed = handovers.reduce((a, h) => ({ expected: a.expected + h.expectedMinor, received: a.received + h.receivedMinor, variance: a.variance + h.varianceMinor }), { expected: 0n, received: 0n, variance: 0n });
    const s = (v: bigint) => v.toString();
    return {
      date, tz, currencyCode, generatedAt: now,
      sales: { byMethod: sales.map((r) => ({ ...r, totalMinor: s(r.totalMinor) })), orders: sales.reduce((n, r) => n + r.orders, 0), totalMinor: s(sum(sales)), cancelledOrders: cancelled._count, cancelledMinor: s(cancelled._sum.totalMinor ?? 0n) },
      cardCaptured: { byMethod: card.map((r) => ({ ...r, totalMinor: s(r.totalMinor) })), totalMinor: s(cardIn) },
      refunds: { byMethod: refunds.map((r) => ({ ...r, totalMinor: s(r.totalMinor) })), totalMinor: s(refundsOut) },
      cash: {
        collectedMinor: s(cashIn), collections: collected._count,
        handedOverExpectedMinor: s(handed.expected), handedOverReceivedMinor: s(handed.received), varianceMinor: s(handed.variance),
        handovers: handovers.map((h) => ({ ...h, expectedMinor: s(h.expectedMinor), receivedMinor: s(h.receivedMinor), varianceMinor: s(h.varianceMinor) })),
        stillWithDriversMinor: s(holding._sum.amountMinor ?? 0n), stillWithDriversCount: holding._count,
      },
      netMinor: s(cardIn + cashIn - refundsOut),
    };
  }

  async closingPdf(day?: string) {
    const r = await this.closing(day);
    return { pdf: await renderDailyClosing(r), name: `FastMoveX-closing-${r.date}.pdf` };
  }
}

// ====================================================================== controller

@ApiTags('Admin / Payments') @ApiBearerAuth()
@Controller({ path: 'admin/payments', version: '1' })
export class ReconciliationController {
  constructor(private readonly svc: ReconciliationService) {}

  @RequirePermissions('payments.read') @Get('exceptions') exceptions(@Query() q: ExceptionsQuery) { return this.svc.exceptions(q.kind); }
  @RequirePermissions('payments.read') @Get('settlements') settlements() { return this.svc.settlements(); }
  @RequirePermissions('payments.read') @Get('settlements/:id') settlement(@Param('id', ParseUUIDPipe) id: string) { return this.svc.settlement(id); }
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @RequirePermissions('payments.reconcile') @HttpCode(201) @Post('settlements')
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() d: SettlementDto, @CurrentUser() u: AuthUser) { return this.svc.settle(file, d.provider || 'dibsy', u); }
  @RequirePermissions('payments.read') @Get('closing') closing(@Query() q: DayQuery) { return this.svc.closing(q.date); }
  @RequirePermissions('payments.read') @Get('closing/pdf')
  async closingPdf(@Query() q: DayQuery, @Res() res: Response) {
    const r = await this.svc.closingPdf(q.date);
    sendPdf(res, r.pdf, r.name);
  }
}

@Module({ controllers: [ReconciliationController], providers: [ReconciliationService] })
export class ReconciliationModule {}
