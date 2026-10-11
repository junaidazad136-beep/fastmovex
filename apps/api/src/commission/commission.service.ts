import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { CommissionScope, CommissionType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { PrismaService } from '../prisma/prisma.service';
import { computeCommission, CommissionTarget, Rule } from './commission.rules';

export class CommissionRuleDto {
  @ApiProperty({ example: 'Electronics 7%' }) @IsString() @Length(2, 80) name: string;
  @ApiProperty({ enum: CommissionScope }) @IsEnum(CommissionScope) scope: CommissionScope;
  @ApiPropertyOptional({ example: 'QA' }) @IsOptional() @Length(2, 2) countryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() campaignId?: string;
  @ApiProperty({ enum: CommissionType }) @IsEnum(CommissionType) type: CommissionType;
  @ApiPropertyOptional({ example: 700, description: '700 = 7%' }) @IsOptional() @IsInt() @Min(0) @Max(10_000) rateBps?: number;
  @ApiPropertyOptional({ description: 'FIXED: charged per unit' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) fixedMinor?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MINOR_AMOUNT_REGEX) minMinor?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MINOR_AMOUNT_REGEX) maxMinor?: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SimulateCommissionDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ example: '10000' }) @Matches(MINOR_AMOUNT_REGEX) netAmountMinor: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(1000) quantity?: number;
}

@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Loads every rule that could apply to this order, once, so checkout does not query per line. */
  async loadRules(countryCode: string): Promise<Rule[]> {
    const rows = await this.prisma.commissionRule.findMany({
      where: { isActive: true, OR: [{ countryCode }, { countryCode: null }] },
      include: { category: { select: { path: true } } },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, scope: r.scope, countryCode: r.countryCode, categoryPath: r.category?.path ?? null,
      sellerId: r.sellerId, productId: r.productId, campaignId: r.campaignId, type: r.type, rateBps: r.rateBps,
      fixedMinor: r.fixedMinor, minMinor: r.minMinor, maxMinor: r.maxMinor, priority: r.priority,
      startsAt: r.startsAt, endsAt: r.endsAt, isActive: r.isActive,
    }));
  }

  compute(rules: Rule[], target: CommissionTarget, now?: Date) {
    return computeCommission(rules, target, now);
  }

  async list() {
    return this.prisma.commissionRule.findMany({ orderBy: [{ scope: 'desc' }, { priority: 'desc' }], include: { category: { select: { slug: true, path: true } } } });
  }

  async create(dto: CommissionRuleDto, actorId: string) {
    this.validate(dto);
    const rule = await this.prisma.commissionRule.create({
      data: {
        name: dto.name, scope: dto.scope, countryCode: dto.countryCode, categoryId: dto.categoryId, sellerId: dto.sellerId,
        productId: dto.productId, campaignId: dto.campaignId, type: dto.type, rateBps: dto.rateBps,
        fixedMinor: dto.fixedMinor ? BigInt(dto.fixedMinor) : null,
        minMinor: dto.minMinor ? BigInt(dto.minMinor) : null,
        maxMinor: dto.maxMinor ? BigInt(dto.maxMinor) : null,
        priority: dto.priority ?? 0, startsAt: dto.startsAt, endsAt: dto.endsAt, isActive: dto.isActive ?? true, createdById: actorId,
      },
    });
    await this.audit.log({ actorId, action: 'commission_rule.create', entityType: 'CommissionRule', entityId: rule.id, after: { scope: rule.scope, type: rule.type, rateBps: rule.rateBps } });
    return rule;
  }

  async update(id: string, dto: Partial<CommissionRuleDto>, actorId: string) {
    const before = await this.prisma.commissionRule.findUniqueOrThrow({ where: { id } });
    const rule = await this.prisma.commissionRule.update({
      where: { id },
      data: {
        name: dto.name, rateBps: dto.rateBps, priority: dto.priority, isActive: dto.isActive, startsAt: dto.startsAt, endsAt: dto.endsAt,
        fixedMinor: dto.fixedMinor ? BigInt(dto.fixedMinor) : undefined,
        minMinor: dto.minMinor ? BigInt(dto.minMinor) : undefined,
        maxMinor: dto.maxMinor ? BigInt(dto.maxMinor) : undefined,
      },
    });
    await this.audit.log({ actorId, action: 'commission_rule.update', entityType: 'CommissionRule', entityId: id, before: { rateBps: before.rateBps, isActive: before.isActive }, after: { rateBps: rule.rateBps, isActive: rule.isActive } });
    return rule;
  }

  /** "What commission would this product pay?" — lets finance check a rule before it goes live. */
  async simulate(dto: SimulateCommissionDto) {
    const p = await this.prisma.product.findUniqueOrThrow({
      where: { id: dto.productId },
      select: { id: true, countryCode: true, category: { select: { path: true } }, store: { select: { sellerId: true } } },
    });
    const rules = await this.loadRules(p.countryCode);
    const target: CommissionTarget = {
      countryCode: p.countryCode, categoryPath: p.category.path, sellerId: p.store.sellerId, productId: p.id,
      campaignId: null, quantity: dto.quantity ?? 1, netAmountMinor: BigInt(dto.netAmountMinor),
    };
    const result = this.compute(rules, target);
    return { ...result, commissionMinor: result.commissionMinor.toString(), sellerReceivesMinor: (target.netAmountMinor - result.commissionMinor).toString() };
  }

  private validate(dto: CommissionRuleDto) {
    if (dto.type === 'PERCENTAGE' && dto.rateBps === undefined) throw new BadRequestException('PERCENTAGE rules need rateBps');
    if (dto.type === 'FIXED' && !dto.fixedMinor) throw new BadRequestException('FIXED rules need fixedMinor');
    const need: Partial<Record<CommissionScope, keyof CommissionRuleDto>> = { CATEGORY: 'categoryId', SELLER: 'sellerId', PRODUCT: 'productId', CAMPAIGN: 'campaignId', COUNTRY: 'countryCode' };
    const field = need[dto.scope];
    if (field && !dto[field]) throw new BadRequestException(`${dto.scope} rules need ${field}`);
    if (dto.endsAt && dto.startsAt && dto.endsAt <= dto.startsAt) throw new BadRequestException('endsAt must be after startsAt');
  }
}

@ApiTags('Admin / Commissions')
@ApiBearerAuth()
@RequirePermissions('commissions.manage')
@Controller({ path: 'admin/commissions', version: '1' })
export class AdminCommissionsController {
  constructor(private readonly svc: CommissionService) {}
  @Get() list() { return this.svc.list(); }
  @Post() create(@Body() dto: CommissionRuleDto, @CurrentUser() u: AuthUser) { return this.svc.create(dto, u.id); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommissionRuleDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u.id); }
  @Post('simulate') simulate(@Body() dto: SimulateCommissionDto) { return this.svc.simulate(dto); }
}

@Module({ controllers: [AdminCommissionsController], providers: [CommissionService], exports: [CommissionService] })
export class CommissionModule {}
