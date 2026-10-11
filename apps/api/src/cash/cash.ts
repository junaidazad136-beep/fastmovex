import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param,
  Optional, ParseUUIDPipe, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { tzFor } from '../analytics/range';
import { EVENTS } from '../notifications/notification.events';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions, Roles } from '../common/decorators/auth.decorators';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { renderCashReceipt } from '../documents/cash-receipt';
import { formatMoney } from '../notifications/templates';
import { PrismaService } from '../prisma/prisma.service';
import { CodGuardService, readCodRules } from './cod-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class HandoverDto {
  @ApiProperty({ description: 'The collections the cashier is counting now (from GET /admin/cash/holders/:userId)', type: [String] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true }) collectionIds: string[];
  @ApiProperty({ example: '45000', description: 'Cash actually counted, minor units' }) @Matches(MINOR_AMOUNT_REGEX) receivedMinor: string;
  @ApiPropertyOptional({ description: 'Required when the count differs from what is expected' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class HandoversQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() holderUserId?: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() shortOnly?: boolean;
}
class CodBlockDto {
  @ApiProperty() @Type(() => Boolean) @IsBoolean() blocked: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reason?: string;
}

const TZ = () => tzFor(process.env.DEFAULT_COUNTRY ?? 'QA');
/** Start of today in the market's time zone, as UTC. */
export function localDayStart(now = new Date(), offsetMin = TZ().offsetMin): Date {
  const shifted = now.getTime() + offsetMin * 60_000;
  return new Date(Math.floor(shifted / 86_400_000) * 86_400_000 - offsetMin * 60_000);
}

/**
 * Cash on delivery, from the door to the cashier. Each delivered COD shipment leaves a CodCollection on the name of
 * whoever holds the cash (OrdersService). A cashier counts it and records a handover: expected vs counted, any
 * shortage stays on record with a note. Rows are append-only in the database (triggers), and nobody can receive
 * their own cash.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async inHand(userId: string) {
    const agg = await this.prisma.codCollection.aggregate({ where: { holderUserId: userId, handoverId: null }, _sum: { amountMinor: true }, _count: true });
    return { amountMinor: agg._sum.amountMinor ?? 0n, count: agg._count };
  }

  /** Drivers holding the market's cash limit must hand it over before picking up more orders. */
  async assertCanPickUp(courierId: string, countryCode: string) {
    const c = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { codRules: true, currencyCode: true } });
    const limit = readCodRules(c?.codRules).driverCashLimitMinor;
    if (!limit) return;
    const held = await this.inHand(courierId);
    if (held.amountMinor >= BigInt(limit)) {
      throw new ForbiddenException({
        message: `You are holding ${formatMoney(held.amountMinor, c!.currencyCode)} in cash. Hand it over to the cashier before picking up more orders.`,
        reason: 'CASH_LIMIT',
      });
    }
  }

  /** Who holds company cash right now, plus today's totals. */
  async holders(now = new Date()) {
    const open = await this.prisma.codCollection.groupBy({
      by: ['holderUserId', 'currencyCode'], where: { handoverId: null },
      _sum: { amountMinor: true }, _count: true, _min: { collectedAt: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: open.map((o) => o.holderUserId) } },
      select: { id: true, fullName: true, phone: true, roles: { select: { role: { select: { code: true } } } } },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const day = localDayStart(now);
    const [collected, handed] = await Promise.all([
      this.prisma.codCollection.aggregate({ where: { collectedAt: { gte: day } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.cashHandover.aggregate({ where: { createdAt: { gte: day } }, _sum: { receivedMinor: true, expectedMinor: true }, _count: true }),
    ]);
    const shortToday = await this.prisma.cashHandover.aggregate({ where: { createdAt: { gte: day }, varianceMinor: { lt: 0 } }, _sum: { varianceMinor: true }, _count: true });
    const rows = open
      .map((o) => {
        const u = byId.get(o.holderUserId);
        return {
          user: { id: o.holderUserId, fullName: u?.fullName ?? '—', phone: u?.phone ?? null, isDriver: !!u?.roles.some((r) => r.role.code === 'DELIVERY_AGENT') },
          amountMinor: (o._sum.amountMinor ?? 0n).toString(), currencyCode: o.currencyCode, orders: o._count, since: o._min.collectedAt,
        };
      })
      .sort((a, b) => Number(BigInt(b.amountMinor) - BigInt(a.amountMinor)));
    return {
      holders: rows,
      today: {
        collectedMinor: (collected._sum.amountMinor ?? 0n).toString(), collectedOrders: collected._count,
        handedOverMinor: (handed._sum.receivedMinor ?? 0n).toString(), handovers: handed._count,
        shortMinor: (-(shortToday._sum.varianceMinor ?? 0n)).toString(), shortHandovers: shortToday._count,
        withHoldersMinor: rows.reduce((n, r) => n + BigInt(r.amountMinor), 0n).toString(),
      },
      currencyCode: rows[0]?.currencyCode ?? 'QAR',
    };
  }

  /** One person's cash: what they hold now (by order) and their recent handovers. */
  async holder(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, phone: true } });
    if (!user) throw new NotFoundException('User not found');
    const open = await this.prisma.codCollection.findMany({
      where: { holderUserId: userId, handoverId: null }, orderBy: { collectedAt: 'asc' }, take: 500,
      select: { id: true, amountMinor: true, currencyCode: true, collectedAt: true, sellerOrder: { select: { order: { select: { orderNumber: true } } } } },
    });
    const handovers = await this.handoverRows({ holderUserId: userId }, 20);
    return {
      user,
      open: open.map((c) => ({ id: c.id, orderNumber: c.sellerOrder.order.orderNumber, amountMinor: c.amountMinor.toString(), currencyCode: c.currencyCode, collectedAt: c.collectedAt })),
      inHandMinor: open.reduce((n, c) => n + c.amountMinor, 0n).toString(),
      currencyCode: open[0]?.currencyCode ?? 'QAR',
      handovers,
    };
  }

  /**
   * The cashier counts the cash for the listed collections. The list is what the cashier saw on screen: if any of it was
   * handed over meanwhile (two cashiers, double click), nothing is recorded and the screen is refreshed.
   */
  async receive(holderUserId: string, dto: HandoverDto, actor: AuthUser) {
    if (holderUserId === actor.id) throw new ForbiddenException('Another person must receive your cash (four-eyes rule)');
    const ids = [...new Set(dto.collectionIds)];
    const received = BigInt(dto.receivedMinor);
    const result = await this.prisma.$transaction(async (tx) => {
      // lock the rows so two cashiers cannot receive the same cash
      const rows = await tx.$queryRaw<{ id: string; amountMinor: bigint; currencyCode: string }[]>`
        SELECT "id", "amountMinor", "currencyCode" FROM "CodCollection"
        WHERE "id" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) AND "holderUserId" = ${holderUserId}::uuid AND "handoverId" IS NULL
        FOR UPDATE`;
      if (rows.length !== ids.length) throw new ConflictException('Some of this cash was already handed over. Refresh and count again.');
      const currencies = new Set(rows.map((r) => r.currencyCode));
      if (currencies.size !== 1) throw new BadRequestException('Count one currency at a time');
      const expected = rows.reduce((n, r) => n + BigInt(r.amountMinor), 0n);
      const variance = received - expected;
      if (variance !== 0n && (dto.note?.length ?? 0) < 5) {
        throw new BadRequestException({ message: `The count is ${variance < 0n ? 'short' : 'over'} by ${formatMoney(variance < 0n ? -variance : variance, [...currencies][0])}. Write a note to explain it.`, reason: 'NOTE_REQUIRED' });
      }
      const country = process.env.DEFAULT_COUNTRY ?? 'QA';
      const d = new Date(Date.now() + TZ().offsetMin * 60_000).toISOString().slice(2, 10).replace(/-/g, '');
      const handover = await tx.cashHandover.create({
        data: {
          number: `CH-${country}-${d}-${randomBytes(3).toString('hex').toUpperCase()}`,
          holderUserId, receivedById: actor.id, expectedMinor: expected, receivedMinor: received, varianceMinor: variance,
          currencyCode: [...currencies][0], note: dto.note || null,
        },
      });
      await tx.codCollection.updateMany({ where: { id: { in: ids } }, data: { handoverId: handover.id } });
      return handover;
    });
    await this.audit.log({
      actorId: actor.id, action: result.varianceMinor < 0n ? 'cash.handover_short' : 'cash.handover', entityType: 'CashHandover', entityId: result.id,
      after: { number: result.number, holderUserId, expectedMinor: result.expectedMinor.toString(), receivedMinor: result.receivedMinor.toString(), varianceMinor: result.varianceMinor.toString(), orders: ids.length, note: result.note },
    });
    if (result.varianceMinor < 0n) this.events?.emit(EVENTS.CASH_SHORT, { id: result.id });
    return (await this.handoverRows({ id: result.id }, 1))[0];
  }

  async handovers(q: HandoversQuery) {
    const where: Prisma.CashHandoverWhereInput = {
      ...(q.holderUserId && { holderUserId: q.holderUserId }),
      ...(q.shortOnly && { varianceMinor: { lt: 0 } }),
      ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lt: new Date(new Date(q.to).getTime() + 86_400_000) }) } }),
    };
    return this.handoverRows(where, 200);
  }

  private async handoverRows(where: Prisma.CashHandoverWhereInput, take: number) {
    const rows = await this.prisma.cashHandover.findMany({
      where, orderBy: { createdAt: 'desc' }, take,
      select: {
        id: true, number: true, createdAt: true, expectedMinor: true, receivedMinor: true, varianceMinor: true, currencyCode: true, note: true,
        holder: { select: { id: true, fullName: true } }, receivedBy: { select: { id: true, fullName: true } }, _count: { select: { collections: true } },
      },
    });
    return rows.map(({ _count, expectedMinor, receivedMinor, varianceMinor, ...h }) => ({
      ...h, orders: _count.collections, expectedMinor: expectedMinor.toString(), receivedMinor: receivedMinor.toString(), varianceMinor: varianceMinor.toString(),
    }));
  }

  /** PDF receipt. Drivers may only open their own. */
  async receipt(id: string, onlyHolder?: string) {
    const h = await this.prisma.cashHandover.findUnique({
      where: { id },
      include: {
        holder: { select: { fullName: true, phone: true } }, receivedBy: { select: { fullName: true } },
        collections: { orderBy: { collectedAt: 'asc' }, select: { amountMinor: true, collectedAt: true, sellerOrder: { select: { order: { select: { orderNumber: true } } } } } },
      },
    });
    if (!h || (onlyHolder && h.holderUserId !== onlyHolder)) throw new NotFoundException('Receipt not found');
    const pdf = await renderCashReceipt({
      number: h.number, createdAt: h.createdAt, tz: TZ().tz, currencyCode: h.currencyCode, holder: h.holder, receivedBy: h.receivedBy,
      expectedMinor: h.expectedMinor, receivedMinor: h.receivedMinor, varianceMinor: h.varianceMinor, note: h.note,
      orders: h.collections.map((c) => ({ orderNumber: c.sellerOrder.order.orderNumber, collectedAt: c.collectedAt, amountMinor: c.amountMinor })),
    });
    return { pdf, number: h.number };
  }

  /** The driver's own view: cash in hand, the limit, which orders it is from, and recent handovers. */
  async mine(userId: string) {
    const me = await this.holder(userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { countryCode: true } });
    const c = await this.prisma.country.findUnique({ where: { code: user.countryCode }, select: { codRules: true } });
    return { ...me, limitMinor: readCodRules(c?.codRules).driverCashLimitMinor, handovers: me.handovers.slice(0, 10) };
  }
}

export function sendPdf(res: Response, pdf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}

@ApiTags('Admin / Cash') @ApiBearerAuth()
@Controller({ path: 'admin/cash', version: '1' })
export class AdminCashController {
  constructor(private readonly cash: CashService) {}
  @RequirePermissions('cash.read') @Get('holders') holders() { return this.cash.holders(); }
  @RequirePermissions('cash.read') @Get('holders/:userId') holder(@Param('userId', ParseUUIDPipe) id: string) { return this.cash.holder(id); }
  @RequirePermissions('cash.receive') @HttpCode(201) @Post('holders/:userId/handover')
  receive(@Param('userId', ParseUUIDPipe) id: string, @Body() dto: HandoverDto, @CurrentUser() u: AuthUser) { return this.cash.receive(id, dto, u); }
  @RequirePermissions('cash.read') @Get('handovers') handovers(@Query() q: HandoversQuery) { return this.cash.handovers(q); }
  @RequirePermissions('cash.read') @Get('handovers/:id/receipt')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.cash.receipt(id);
    sendPdf(res, r.pdf, `${r.number}.pdf`);
  }
}

/** Drivers: their own cash only. */
@ApiTags('Courier') @ApiBearerAuth() @Roles('DELIVERY_AGENT')
@Controller({ path: 'courier/cash', version: '1' })
export class CourierCashController {
  constructor(private readonly cash: CashService) {}
  @Get() mine(@CurrentUser() u: AuthUser) { return this.cash.mine(u.id); }
  @Get('handovers/:id/receipt')
  async receipt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const r = await this.cash.receipt(id, u.id);
    sendPdf(res, r.pdf, `${r.number}.pdf`);
  }
}

/** Staff switch cash on delivery off/on for a customer. */
@ApiTags('Admin / Users') @ApiBearerAuth()
@Controller({ path: 'admin/users', version: '1' })
export class AdminCodBlockController {
  constructor(private readonly cod: CodGuardService) {}
  @RequirePermissions('users.update') @HttpCode(200) @Post(':id/cod')
  set(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CodBlockDto, @CurrentUser() u: AuthUser) { return this.cod.setBlocked(id, dto.blocked, dto.reason, u.id); }
}

@Module({
  controllers: [AdminCashController, CourierCashController, AdminCodBlockController],
  providers: [CashService, CodGuardService],
  exports: [CashService, CodGuardService],
})
export class CashModule {}
