import {
  BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { CouponScope, CouponType, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CreateCouponDto {
  @ApiProperty({ example: 'WELCOME10' }) @Transform(upper) @Matches(/^[A-Z0-9_-]{3,40}$/) code: string;
  @ApiPropertyOptional({ example: 'QA' }) @IsOptional() @Transform(upper) @Length(2, 2) countryCode?: string;
  @ApiProperty({ enum: CouponType }) @IsEnum(CouponType) type: CouponType;
  @ApiPropertyOptional({ enum: CouponScope, default: 'PLATFORM' }) @IsOptional() @IsEnum(CouponScope) scope?: CouponScope;
  @ApiPropertyOptional({ example: 1000, description: 'PERCENTAGE only. 1000 = 10%' }) @IsOptional() @IsInt() @Min(1) @Max(9000) valueBps?: number;
  @ApiPropertyOptional({ example: '2000', description: 'FIXED only, minor units' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) valueMinor?: string;
  @ApiPropertyOptional({ example: '5000' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) maxDiscountMinor?: string;
  @ApiPropertyOptional({ example: '10000' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) minOrderMinor?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @ApiPropertyOptional({ description: 'Only users registered within N days' }) @IsOptional() @IsInt() @Min(1) @Max(365) newCustomerDays?: number;
  @ApiProperty() @Type(() => Date) @IsDate() startsAt: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endsAt: Date;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000_000) usageLimit?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(100) perUserLimit?: number;
}

export class UpdateCouponDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000_000) usageLimit?: number;
}

export class ListCouponsQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

/** Validates the shape of a coupon so nonsense (a 0% coupon, a FIXED coupon without amount) can't be saved. Exported for tests. */
export function validateCouponShape(d: CreateCouponDto) {
  if (d.endsAt <= d.startsAt) throw new BadRequestException('endsAt must be after startsAt');
  if (d.type === 'PERCENTAGE' && !d.valueBps) throw new BadRequestException('PERCENTAGE coupons need valueBps');
  if (d.type === 'FIXED' && !d.valueMinor) throw new BadRequestException('FIXED coupons need valueMinor');
  if (d.type !== 'PERCENTAGE' && d.valueBps) throw new BadRequestException('valueBps is only for PERCENTAGE coupons');
  if (d.type !== 'FIXED' && d.valueMinor) throw new BadRequestException('valueMinor is only for FIXED coupons');
  const scope = d.scope ?? 'PLATFORM';
  if (scope === 'SELLER' && !d.sellerId) throw new BadRequestException('SELLER coupons need sellerId');
  if (scope === 'CATEGORY' && !d.categoryId) throw new BadRequestException('CATEGORY coupons need categoryId');
  if (scope !== 'SELLER' && d.sellerId) throw new BadRequestException('sellerId is only for SELLER coupons');
  if (scope !== 'CATEGORY' && d.categoryId) throw new BadRequestException('categoryId is only for CATEGORY coupons');
}

@Injectable()
export class CouponsAdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(d: CreateCouponDto, actorId: string, forcedSellerId?: string, defaultCountry = 'QA') {
    const dto = forcedSellerId ? { ...d, scope: 'SELLER' as const, sellerId: forcedSellerId, categoryId: undefined } : d;
    validateCouponShape(dto);
    try {
      const c = await this.prisma.coupon.create({
        data: {
          code: dto.code, countryCode: dto.countryCode ?? defaultCountry, type: dto.type, scope: dto.scope ?? 'PLATFORM',
          fundedBy: forcedSellerId ? 'SELLER' : 'PLATFORM', // who pays the discount: decides ledger entries at order time
          valueBps: dto.valueBps, valueMinor: dto.valueMinor ? BigInt(dto.valueMinor) : null,
          maxDiscountMinor: dto.maxDiscountMinor ? BigInt(dto.maxDiscountMinor) : null,
          minOrderMinor: dto.minOrderMinor ? BigInt(dto.minOrderMinor) : 0n,
          sellerId: dto.sellerId, categoryId: dto.categoryId, firstOrderOnly: dto.firstOrderOnly ?? false,
          newCustomerDays: dto.newCustomerDays, startsAt: dto.startsAt, endsAt: dto.endsAt,
          usageLimit: dto.usageLimit, perUserLimit: dto.perUserLimit ?? 1,
        },
      });
      await this.audit.log({ actorId, action: 'coupon.create', entityType: 'Coupon', entityId: c.id, after: { code: c.code, type: c.type, scope: c.scope } });
      return c;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('This code already exists in this country');
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new BadRequestException('Seller or category not found');
      throw e;
    }
  }

  async list(q: ListCouponsQuery, sellerId?: string) {
    const rows = await this.prisma.coupon.findMany({
      where: { sellerId, ...(q.q && { code: { contains: q.q.toUpperCase() } }), ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    });
    return toPage(rows, 25);
  }

  async update(id: string, d: UpdateCouponDto, actorId: string, sellerId?: string) {
    const c = await this.prisma.coupon.findFirst({ where: { id, sellerId } });
    if (!c) throw new NotFoundException('Coupon not found');
    if (d.endsAt && d.endsAt <= c.startsAt) throw new BadRequestException('endsAt must be after startsAt');
    const updated = await this.prisma.coupon.update({ where: { id }, data: d });
    await this.audit.log({ actorId, action: 'coupon.update', entityType: 'Coupon', entityId: id, after: { ...d } as Prisma.InputJsonValue });
    return updated;
  }
}

@ApiTags('Admin / Coupons')
@ApiBearerAuth()
@RequirePermissions('coupons.manage')
@Controller({ path: 'admin/coupons', version: '1' })
export class AdminCouponsController {
  constructor(private readonly svc: CouponsAdminService) {}
  @Get() list(@Query() q: ListCouponsQuery) { return this.svc.list(q); }
  @Post() create(@Body() d: CreateCouponDto, @CurrentUser() u: AuthUser) { return this.svc.create(d, u.id); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateCouponDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, d, u.id); }
}

/** Sellers can only create coupons for their own store, funded by themselves. */
@ApiTags('Seller / Coupons')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@Controller({ path: 'seller/coupons', version: '1' })
export class SellerCouponsController {
  constructor(private readonly svc: CouponsAdminService) {}
  @Get() list(@CurrentSeller() s: SellerContext, @Query() q: ListCouponsQuery) { return this.svc.list(q, s.id); }
  @Post() create(@CurrentSeller() s: SellerContext, @Body() d: CreateCouponDto, @CurrentUser() u: AuthUser) { return this.svc.create(d, u.id, s.id, s.countryCode); }
  @Patch(':id') update(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateCouponDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, d, u.id, s.id); }
}

@Module({ controllers: [AdminCouponsController, SellerCouponsController], providers: [CouponsAdminService] })
export class CouponsModule {}
