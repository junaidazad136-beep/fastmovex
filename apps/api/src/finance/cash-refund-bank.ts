import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Put, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CryptoService } from '../common/crypto/crypto.service';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { OrderAccessService } from '../common/order-access.service';
import { isValidIban, normalizeIban } from '../common/utils/iban';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RefundBankDto {
  @ApiProperty({ example: 'Reem Al-Kuwari' }) @Transform(trim) @IsString() @Length(2, 120) accountHolder: string;
  @ApiProperty({ example: 'QA58DOHB00001234567890ABCDEFG' }) @IsString() @Length(15, 40) iban: string;
}

/** Refund states in which the customer may still give or correct the account (not once the money is sent). */
const OPEN = ['PENDING', 'PROCESSING'] as const;

/** The customer-facing view of one cash refund. */
export interface CashRefundView { id: string; amountMinor: string; status: string; needsBank: boolean; ibanLast4: string | null; accountHolder: string | null }

/** Cash refunds of one order, for the customer's order page (shared with the orders module). */
export async function cashRefundsForOrder(prisma: PrismaService, orderId: string): Promise<CashRefundView[]> {
  const rows = await prisma.refund.findMany({
    where: { orderId, payment: { method: 'COD' }, status: { not: 'FAILED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amountMinor: true, status: true, bankIbanLast4: true, bankAccountHolder: true },
  });
  return rows.map((r) => ({
    id: r.id, amountMinor: r.amountMinor.toString(), status: r.status,
    needsBank: (OPEN as readonly string[]).includes(r.status) && !r.bankIbanLast4,
    ibanLast4: r.bankIbanLast4, accountHolder: r.bankAccountHolder,
  }));
}

/**
 * Cash-on-delivery refunds cannot go back to a card: finance sends a bank transfer. The customer gives the account
 * here (encrypted at rest, only the last 4 shown again); finance sees the full IBAN only through an audited lookup.
 */
@Injectable()
export class CashRefundBankService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService, private readonly audit: AuditService) {}

  /** Cash refunds of one order, for the customer's order page. */
  forOrder(orderId: string): Promise<CashRefundView[]> {
    return cashRefundsForOrder(this.prisma, orderId);
  }

  async save(orderId: string, refundId: string, dto: RefundBankDto, actor: { id?: string; guest?: boolean }) {
    const refund = await this.prisma.refund.findFirst({ where: { id: refundId, orderId }, select: { id: true, status: true, payment: { select: { method: true } } } });
    if (!refund || refund.payment.method !== 'COD') throw new NotFoundException('Refund not found');
    if (!(OPEN as readonly string[]).includes(refund.status)) throw new BadRequestException('This refund has already been sent. Contact us if something is wrong.');
    const iban = normalizeIban(dto.iban);
    if (!isValidIban(iban)) throw new BadRequestException('IBAN is not valid. Check it on your bank statement or app.');
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { bankIbanEncrypted: this.crypto.encrypt(iban), bankIbanLast4: iban.slice(-4), bankAccountHolder: dto.accountHolder, bankDetailsAt: new Date() },
    });
    await this.audit.log({ actorId: actor.id ?? null, action: 'refund.bank_details', entityType: 'Refund', entityId: refund.id, after: { ibanLast4: iban.slice(-4), byGuest: !!actor.guest } });
    return { id: refund.id, ibanLast4: iban.slice(-4), accountHolder: dto.accountHolder };
  }

  /** Finance opens the full IBAN to make the transfer. Every look is audited. */
  async reveal(refundId: string, staffId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, select: { bankIbanEncrypted: true, bankAccountHolder: true, amountMinor: true } });
    if (!r) throw new NotFoundException('Refund not found');
    if (!r.bankIbanEncrypted) throw new NotFoundException('The customer has not given a bank account yet');
    await this.audit.log({ actorId: staffId, action: 'refund.bank_viewed', entityType: 'Refund', entityId: refundId });
    return { iban: this.crypto.decrypt(r.bankIbanEncrypted), accountHolder: r.bankAccountHolder, amountMinor: r.amountMinor.toString() };
  }
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class CustomerCashRefundController {
  constructor(private readonly svc: CashRefundBankService, private readonly prisma: PrismaService) {}

  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Put(':orderNumber/refunds/:refundId/bank')
  async save(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Param('refundId', ParseUUIDPipe) id: string, @Body() dto: RefundBankDto) {
    const o = await this.prisma.order.findFirst({ where: { orderNumber: n.toUpperCase(), userId: u.id }, select: { id: true } });
    if (!o) throw new NotFoundException('Order not found');
    return this.svc.save(o.id, id, dto, { id: u.id });
  }
}

@ApiTags('Orders')
@Controller({ path: 'orders/guest', version: '1' })
export class GuestCashRefundController {
  constructor(private readonly svc: CashRefundBankService, private readonly prisma: PrismaService, private readonly access: OrderAccessService) {}

  @Public() @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) @ApiHeader({ name: 'X-Order-Token', required: true })
  @Put(':orderNumber/refunds/:refundId/bank')
  async save(@Param('orderNumber') n: string, @Param('refundId', ParseUUIDPipe) id: string, @Body() dto: RefundBankDto, @Headers('x-order-token') token?: string) {
    const o = await this.prisma.order.findUnique({ where: { orderNumber: n.toUpperCase() }, select: { id: true, user: { select: { isGuest: true } } } });
    if (!o || !o.user.isGuest || !this.access.verify(o.id, token)) throw new UnauthorizedException('This link has expired or is not valid. Look the order up with its number and your email.');
    return this.svc.save(o.id, id, dto, { guest: true });
  }

  @Public() @Throttle({ default: { limit: 30, ttl: 3_600_000 } }) @ApiHeader({ name: 'X-Order-Token', required: true })
  @Get(':orderNumber/cash-refunds')
  async list(@Param('orderNumber') n: string, @Headers('x-order-token') token?: string) {
    const o = await this.prisma.order.findUnique({ where: { orderNumber: n.toUpperCase() }, select: { id: true, user: { select: { isGuest: true } } } });
    if (!o || !o.user.isGuest || !this.access.verify(o.id, token)) throw new UnauthorizedException('This link has expired or is not valid.');
    return this.svc.forOrder(o.id);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminCashRefundController {
  constructor(private readonly svc: CashRefundBankService) {}

  @RequirePermissions('refunds.approve') @HttpCode(200) @Get('refunds/:id/bank')
  reveal(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.reveal(id, u.id); }
}
