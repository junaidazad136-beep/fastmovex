import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Optional, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { CampaignType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOAD_LIMITS, validateUpload } from '../storage/file-validation';
import { StorageService } from '../storage/storage.service';
import { StorefrontService } from '../common/storefront.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
export const PLACEMENTS = ['HOME_HERO', 'HOME_MID', 'CATEGORY_TOP'] as const;

class CampaignDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 100) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 100) nameAr?: string;
  @ApiProperty({ enum: CampaignType }) @IsEnum(CampaignType) type: CampaignType;
  @ApiPropertyOptional({ default: 'QA' }) @IsOptional() @Transform(upper) @Length(2, 2) countryCode?: string;
  @ApiProperty() @Type(() => Date) @IsDate() startsAt: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endsAt: Date;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class CampaignPatch {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class CampaignProductDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ example: '7900' }) @Matches(MINOR_AMOUNT_REGEX) dealPriceMinor: string;
  @ApiPropertyOptional({ description: 'Max units sold at the deal price' }) @IsOptional() @IsInt() @Min(1) @Max(1_000_000) stockLimit?: number;
}
class BannerDto {
  @ApiPropertyOptional({ default: 'QA' }) @IsOptional() @Transform(upper) @Length(2, 2) countryCode?: string;
  @ApiProperty({ enum: PLACEMENTS }) @IsIn(PLACEMENTS) placement: string;
  @ApiPropertyOptional({ enum: ['en', 'ar'] }) @IsOptional() @IsIn(['en', 'ar']) locale?: string;
  @ApiPropertyOptional({ example: '/search?category=perfumes' })
  @IsOptional() @MaxLength(500) @Matches(/^(\/[^\s]*|https:\/\/[^\s]+)$/, { message: 'Link must be a site path (/...) or an https URL' }) linkUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() isActive?: boolean;
  // Text drawn on the banner by the website (empty string clears it)
  @ApiPropertyOptional({ example: 'Limited time' }) @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) kicker?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30) kickerAr?: string | null;
  @ApiPropertyOptional({ example: 'Big deals\nUp to *50% off*', description: 'Up to two lines; words between *stars* are coloured' })
  @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) @Matches(/^[^\n]*(\n[^\n]*)?$/, { message: 'The headline has at most two lines' }) headline?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) @Matches(/^[^\n]*(\n[^\n]*)?$/, { message: 'The headline has at most two lines' }) headlineAr?: string | null;
  @ApiPropertyOptional({ example: 'Top brands • Best prices • Qatar delivery' }) @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) subline?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) sublineAr?: string | null;
  @ApiPropertyOptional({ example: 'Shop now' }) @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(24) ctaLabel?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(bannerText) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(24) ctaLabelAr?: string | null;
}
/** Banner text: trimmed, Windows line breaks unified, empty = none. Exported for tests. */
export function bannerText({ value }: { value: unknown }) {
  if (typeof value !== 'string') return value;
  const v = value.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).join('\n').trim();
  return v === '' ? null : v;
}
class SponsorDto { @ApiPropertyOptional({ nullable: true, description: 'null ends sponsorship' }) @IsOptional() @Type(() => Date) @IsDate() until?: Date | null; }
class FeatureDto { @ApiProperty() @IsBoolean() featured: boolean; }

/** A deal must be a real discount and stay above zero — the "cheapest" promise is never made, deals are. Exported for tests. */
export function assertDealPrice(deal: bigint, regular: bigint) {
  if (deal <= 0n) throw new BadRequestException('Deal price must be above zero');
  if (deal >= regular) throw new BadRequestException('Deal price must be lower than the regular price');
}

@Injectable()
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  private bust(country = 'QA') { this.storefront?.refresh('home', 'offers'); return this.cache.del(`home:${country}`); }

  listCampaigns() {
    return this.prisma.campaign.findMany({ orderBy: { startsAt: 'desc' }, take: 100, include: { _count: { select: { products: true } } } });
  }

  async createCampaign(d: CampaignDto, adminId: string) {
    if (d.endsAt <= d.startsAt) throw new BadRequestException('endsAt must be after startsAt');
    const c = await this.prisma.campaign.create({ data: { ...d, countryCode: d.countryCode ?? 'QA' } });
    await this.audit.log({ actorId: adminId, action: 'campaign.create', entityType: 'Campaign', entityId: c.id });
    await this.bust(c.countryCode);
    return c;
  }

  async updateCampaign(id: string, d: CampaignPatch, adminId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    if (d.endsAt && d.endsAt <= c.startsAt) throw new BadRequestException('endsAt must be after startsAt');
    const u = await this.prisma.campaign.update({ where: { id }, data: d });
    await this.audit.log({ actorId: adminId, action: 'campaign.update', entityType: 'Campaign', entityId: id, after: { ...d } });
    await this.bust(c.countryCode);
    return u;
  }

  async campaignProducts(id: string) {
    const rows = await this.prisma.campaignProduct.findMany({
      where: { campaignId: id },
      include: { variant: { select: { sku: true, priceMinor: true, product: { select: { title: true, slug: true } } } } },
    });
    return rows.map((r) => ({ ...r, dealPriceMinor: r.dealPriceMinor.toString(), variant: { ...r.variant, priceMinor: r.variant.priceMinor.toString() } }));
  }

  async addProduct(campaignId: string, d: CampaignProductDto, adminId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { countryCode: true } });
    if (!c) throw new NotFoundException('Campaign not found');
    const v = await this.prisma.productVariant.findUnique({ where: { id: d.variantId }, select: { priceMinor: true, isActive: true, product: { select: { countryCode: true, status: true } } } });
    if (!v || !v.isActive || v.product.status !== 'ACTIVE') throw new BadRequestException('Variant not found or not live');
    if (v.product.countryCode !== c.countryCode) throw new BadRequestException('Product is sold in a different market than this campaign');
    const deal = BigInt(d.dealPriceMinor);
    assertDealPrice(deal, v.priceMinor);
    await this.prisma.campaignProduct.upsert({
      where: { campaignId_variantId: { campaignId, variantId: d.variantId } },
      update: { dealPriceMinor: deal, stockLimit: d.stockLimit ?? null },
      create: { campaignId, variantId: d.variantId, dealPriceMinor: deal, stockLimit: d.stockLimit },
    });
    await this.audit.log({ actorId: adminId, action: 'campaign.product_set', entityType: 'Campaign', entityId: campaignId, after: { variantId: d.variantId, dealPriceMinor: d.dealPriceMinor } });
    await this.bust(c.countryCode);
    return this.campaignProducts(campaignId);
  }

  async removeProduct(campaignId: string, variantId: string, adminId: string) {
    await this.prisma.campaignProduct.deleteMany({ where: { campaignId, variantId } });
    await this.audit.log({ actorId: adminId, action: 'campaign.product_remove', entityType: 'Campaign', entityId: campaignId, after: { variantId } });
    await this.bust();
  }

  async listBanners() {
    const rows = await this.prisma.banner.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }], take: 200 });
    return rows.map((b) => ({ ...b, imageUrl: this.storage.publicUrl(b.imageKey) }));
  }

  async createBanner(d: BannerDto, file: Express.Multer.File | undefined, adminId: string) {
    const f = validateUpload(file, 'image');
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) throw new BadRequestException('endsAt must be after startsAt');
    const key = `banners/${randomUUID()}.${f.ext}`;
    await this.storage.put('public', key, f.buffer, f.mime);
    const b = await this.prisma.banner.create({ data: { ...d, countryCode: d.countryCode ?? 'QA', imageKey: key, isActive: d.isActive ?? true } });
    await this.audit.log({ actorId: adminId, action: 'banner.create', entityType: 'Banner', entityId: b.id });
    await this.bust(b.countryCode);
    return { ...b, imageUrl: this.storage.publicUrl(key) };
  }

  async updateBanner(id: string, d: BannerDto, adminId: string) {
    const b = await this.prisma.banner.update({ where: { id }, data: d }).catch(() => { throw new NotFoundException('Banner not found'); });
    await this.audit.log({ actorId: adminId, action: 'banner.update', entityType: 'Banner', entityId: id });
    await this.bust(b.countryCode);
    return b;
  }

  async deleteBanner(id: string, adminId: string) {
    const b = await this.prisma.banner.delete({ where: { id } }).catch(() => { throw new NotFoundException('Banner not found'); });
    await this.storage.delete('public', b.imageKey).catch(() => undefined);
    await this.audit.log({ actorId: adminId, action: 'banner.delete', entityType: 'Banner', entityId: id });
    await this.bust(b.countryCode);
  }

  async sponsor(productId: string, until: Date | null | undefined, adminId: string) {
    const p = await this.prisma.product.update({ where: { id: productId }, data: { sponsoredUntil: until ?? null } }).catch(() => { throw new NotFoundException('Product not found'); });
    await this.audit.log({ actorId: adminId, action: 'product.sponsor', entityType: 'Product', entityId: productId, after: { until: until?.toISOString() ?? null } });
    await this.bust(p.countryCode);
    return { id: productId, sponsoredUntil: p.sponsoredUntil };
  }

  async featureStore(storeId: string, featured: boolean, adminId: string) {
    await this.prisma.store.update({ where: { id: storeId }, data: { isFeatured: featured } }).catch(() => { throw new NotFoundException('Store not found'); });
    await this.audit.log({ actorId: adminId, action: featured ? 'store.feature' : 'store.unfeature', entityType: 'Store', entityId: storeId });
    await this.bust();
    return { id: storeId, isFeatured: featured };
  }
}

@ApiTags('Admin / Marketing') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class MarketingController {
  constructor(private readonly svc: MarketingService) {}

  @RequirePermissions('campaigns.manage') @Get('campaigns') campaigns() { return this.svc.listCampaigns(); }
  @RequirePermissions('campaigns.manage') @Post('campaigns') create(@Body() d: CampaignDto, @CurrentUser() u: AuthUser) { return this.svc.createCampaign(d, u.id); }
  @RequirePermissions('campaigns.manage') @Patch('campaigns/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() d: CampaignPatch, @CurrentUser() u: AuthUser) { return this.svc.updateCampaign(id, d, u.id); }
  @RequirePermissions('campaigns.manage') @Get('campaigns/:id/products') products(@Param('id', ParseUUIDPipe) id: string) { return this.svc.campaignProducts(id); }
  @RequirePermissions('campaigns.manage') @Post('campaigns/:id/products') add(@Param('id', ParseUUIDPipe) id: string, @Body() d: CampaignProductDto, @CurrentUser() u: AuthUser) { return this.svc.addProduct(id, d, u.id); }
  @RequirePermissions('campaigns.manage') @HttpCode(204) @Delete('campaigns/:id/products/:variantId')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('variantId', ParseUUIDPipe) v: string, @CurrentUser() u: AuthUser) { return this.svc.removeProduct(id, v, u.id); }

  @RequirePermissions('banners.manage') @Get('banners') banners() { return this.svc.listBanners(); }
  @RequirePermissions('banners.manage') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Post('banners') createBanner(@Body() d: BannerDto, @UploadedFile() f: Express.Multer.File, @CurrentUser() u: AuthUser) { return this.svc.createBanner(d, f, u.id); }
  @RequirePermissions('banners.manage') @Patch('banners/:id') updateBanner(@Param('id', ParseUUIDPipe) id: string, @Body() d: BannerDto, @CurrentUser() u: AuthUser) { return this.svc.updateBanner(id, d, u.id); }
  @RequirePermissions('banners.manage') @HttpCode(204) @Delete('banners/:id') deleteBanner(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.deleteBanner(id, u.id); }

  @RequirePermissions('featured.manage') @HttpCode(200) @Post('products/:id/sponsor') sponsor(@Param('id', ParseUUIDPipe) id: string, @Body() d: SponsorDto, @CurrentUser() u: AuthUser) { return this.svc.sponsor(id, d.until, u.id); }
  @RequirePermissions('featured.manage') @HttpCode(200) @Post('stores/:id/feature') feature(@Param('id', ParseUUIDPipe) id: string, @Body() d: FeatureDto, @CurrentUser() u: AuthUser) { return this.svc.featureStore(id, d.featured, u.id); }
}

@Module({ controllers: [MarketingController], providers: [MarketingService] })
export class MarketingModule {}

