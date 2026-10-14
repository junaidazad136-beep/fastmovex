import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus, PayoutStatus, RefundStatus, ReturnStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { PaymentsModule } from '../payments/payments.controller';
import { FinanceSummaryService, PayoutsService } from './payouts.service';
import { RefundsService } from './refunds.service';
import { ReleaseService } from './release.service';
import { ReturnsService } from './returns.service';
import { SellerLedgerQuery } from './seller-ledger.query';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ReturnRequestDto {
  @ApiProperty() @IsUUID() orderItemId: string;
  @ApiProperty() @IsInt() @Min(1) @Max(99) quantity: number;
  @ApiProperty({ example: 'Arrived damaged' }) @Transform(trim) @IsString() @Length(5, 500) reason: string;
}
class DecisionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) resolution?: string;
}
class ReturnsQuery {
  @ApiPropertyOptional({ enum: ReturnStatus }) @IsOptional() @IsEnum(ReturnStatus) status?: ReturnStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class RefundsQuery {
  @ApiPropertyOptional({ enum: RefundStatus }) @IsOptional() @IsEnum(RefundStatus) status?: RefundStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class PaymentsQuery {
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class PayoutsQuery { @ApiPropertyOptional({ enum: PayoutStatus }) @IsOptional() @IsEnum(PayoutStatus) status?: PayoutStatus; }
class CursorQuery { @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string; }
class PayoutRequestDto { @ApiProperty({ example: '50000' }) @Matches(MINOR_AMOUNT_REGEX) amountMinor: string; }
class SellerReceivedDto {
  @ApiPropertyOptional({ enum: ['SELLABLE', 'DAMAGED', 'NOT_ACCEPTED'], default: 'SELLABLE' }) @IsOptional()
  @IsIn(['SELLABLE', 'DAMAGED', 'NOT_ACCEPTED']) condition?: 'SELLABLE' | 'DAMAGED' | 'NOT_ACCEPTED';
  @ApiPropertyOptional({ description: 'Required unless sellable' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class ReceivedDto {
  @ApiProperty({ enum: ['SELLABLE', 'DAMAGED', 'NOT_ACCEPTED'], description: 'What the item looked like when it came back' })
  @IsIn(['SELLABLE', 'DAMAGED', 'NOT_ACCEPTED']) condition: 'SELLABLE' | 'DAMAGED' | 'NOT_ACCEPTED';
  @ApiPropertyOptional({ description: 'Required unless sellable' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class ReasonDto { @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string; }
class ReferenceDto { @ApiProperty({ example: 'QNB-TRF-88213' }) @Transform(trim) @IsString() @Length(3, 100) reference: string; }
class ManualRefundDto {
  @ApiProperty() @IsString() @Length(5, 40) orderNumber: string;
  @ApiProperty() @IsUUID() sellerOrderId: string;
  @ApiProperty({ example: '2500' }) @Matches(MINOR_AMOUNT_REGEX) amountMinor: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 500) reason: string;
}

// ------------------------------------------------------------------ customer

@ApiTags('Returns')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CustomerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('orders/:orderNumber/returns')
  request(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Body() dto: ReturnRequestDto) {
    return this.returns.request(u.id, n, dto);
  }

  @Get('me/returns') mine(@CurrentUser() u: AuthUser) { return this.returns.listForCustomer(u.id); }
}

// -------------------------------------------------------------------- seller

@ApiTags('Seller / Finance')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@Controller({ path: 'seller', version: '1' })
export class SellerFinanceController {
  constructor(private readonly payouts: PayoutsService, private readonly returns: ReturnsService) {}

  @Get('finance/balance') balance(@CurrentSeller() s: SellerContext) { return this.payouts.balance(s); }
  @Get('finance/statement') statement(@CurrentSeller() s: SellerContext, @Query() q: CursorQuery) { return this.payouts.statement(s, q.cursor); }

  @Get('payouts') list(@CurrentSeller() s: SellerContext) { return this.payouts.listForSeller(s.id); }
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('payouts') request(@CurrentSeller() s: SellerContext, @Body() dto: PayoutRequestDto, @CurrentUser() u: AuthUser) {
    return this.payouts.request(s, BigInt(dto.amountMinor), u.id);
  }

  @Get('returns') returnsList(@CurrentSeller() s: SellerContext, @Query() q: ReturnsQuery) { return this.returns.listForSeller(s.id, q); }
  @HttpCode(200) @Post('returns/:id/decision')
  decide(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser) {
    return this.returns.decide(id, dto.decision, u.id, s.id, dto.resolution);
  }
  /** The item is back with the seller: sellable (default), damaged, or not accepted (with what was wrong). */
  @HttpCode(200) @Post('returns/:id/received')
  received(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SellerReceivedDto, @CurrentUser() u: AuthUser) {
    return this.returns.markReceived(id, u.id, s.id, { condition: dto.condition, note: dto.note });
  }
}

// --------------------------------------------------------------------- admin

@ApiTags('Admin / Finance')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminFinanceController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly payouts: PayoutsService,
    private readonly returns: ReturnsService,
    private readonly release: ReleaseService,
    private readonly summary: FinanceSummaryService,
  ) {}

  @RequirePermissions('ledger.read') @Get('finance/summary') financeSummary() { return this.summary.summary(); }
  @RequirePermissions('payouts.approve') @HttpCode(200) @Post('finance/release-due')
  releaseNow(@CurrentUser() u: AuthUser) { return this.release.releaseNow(u.id); }

  @RequirePermissions('payments.read') @Get('payments')
  payments(@Query() q: PaymentsQuery) { return this.refunds.listPayments(q); }

  @RequirePermissions('payments.read') @Get('refunds') refundList(@Query() q: RefundsQuery) { return this.refunds.list(q); }
  @RequirePermissions('refunds.create') @Post('refunds')
  createRefund(@Body() dto: ManualRefundDto, @CurrentUser() u: AuthUser) {
    return this.refunds.createManual({ ...dto, amountMinor: BigInt(dto.amountMinor) }, u.id);
  }
  @RequirePermissions('refunds.approve') @HttpCode(200) @Post('refunds/:id/approve')
  approveRefund(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.refunds.approve(id, u); }
  @RequirePermissions('refunds.approve') @HttpCode(200) @Post('refunds/:id/reject')
  rejectRefund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser) { return this.refunds.reject(id, u.id, dto.reason); }
  @RequirePermissions('refunds.approve') @HttpCode(200) @Post('refunds/:id/mark-paid')
  refundPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReferenceDto, @CurrentUser() u: AuthUser) { return this.refunds.markPaid(id, u, dto.reference); }

  @RequirePermissions('payouts.read') @Get('payouts') payoutList(@Query() q: PayoutsQuery) { return this.payouts.listForAdmin(q.status); }
  @RequirePermissions('payouts.approve') @HttpCode(200) @Post('payouts/:id/approve')
  approvePayout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.payouts.approve(id, u); }
  @RequirePermissions('payouts.approve') @HttpCode(200) @Post('payouts/:id/reject')
  rejectPayout(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser) { return this.payouts.reject(id, u, dto.reason); }
  @RequirePermissions('payouts.mark_paid') @HttpCode(200) @Post('payouts/:id/mark-paid')
  payoutPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReferenceDto, @CurrentUser() u: AuthUser) { return this.payouts.markPaid(id, u, dto.reference); }

  @RequirePermissions('returns.manage') @Get('returns') returnList(@Query() q: ReturnsQuery) { return this.returns.listForAdmin(q); }
  @RequirePermissions('returns.manage') @HttpCode(200) @Post('returns/:id/decision')
  decideReturn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser) { return this.returns.decide(id, dto.decision, u.id, undefined, dto.resolution); }
  @RequirePermissions('returns.manage') @HttpCode(200) @Post('returns/:id/received')
  receivedReturn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceivedDto, @CurrentUser() u: AuthUser) { return this.returns.markReceived(id, u.id, undefined, dto); }
}

@Module({
  imports: [PaymentsModule],
  controllers: [CustomerReturnsController, SellerFinanceController, AdminFinanceController],
  providers: [RefundsService, PayoutsService, ReturnsService, ReleaseService, FinanceSummaryService, SellerLedgerQuery],
})
export class FinanceModule {}

