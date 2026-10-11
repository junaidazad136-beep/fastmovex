import { Body, ConflictException, Controller, Get, Module, NotFoundException, Optional, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { StorefrontService } from '../common/storefront.service';
import { SeoFieldsDto } from '../seo/seo-fields.dto';
import { ApiBearerAuth, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { slugify } from '../common/utils/slug';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class BrandQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
}
export class UpsertBrandDto extends SeoFieldsDto {
  @ApiProperty({ example: 'Apple' }) @Transform(trim) @IsString() @Length(1, 80) name: string;
  @ApiPropertyOptional({ example: 'أبل' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value)) @IsString() @Length(1, 80) nameAr?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @Length(1, 80) slug?: string;
}

/** Only the fields that were sent; null clears one. */
function brandData(dto: UpsertBrandDto) {
  const keys = ['nameAr', 'description', 'descriptionAr', 'seoTitle', 'seoTitleAr', 'seoDescription', 'seoDescriptionAr'] as const;
  return Object.fromEntries(keys.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k] ?? null]));
}

@ApiTags('Brands')
@Controller({ version: '1' })
export class BrandsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly cache: CacheService, @Optional() private readonly storefront?: StorefrontService) {}

  private async changed(slugs: (string | null | undefined)[]) {
    const list = [...new Set(slugs.filter((x): x is string => !!x))];
    const country = process.env.DEFAULT_COUNTRY ?? 'QA';
    await this.cache.del(...list.map((sl) => `brand:${country}:${sl}`), `sitemap:${country}:brands`);
    this.storefront?.refresh('sitemap', ...list.map((sl) => `brand:${sl}`));
  }

  /** Used by the seller "Add product" brand picker and search filters. */
  @Public() @Get('brands')
  list(@Query() q: BrandQueryDto) {
    return this.prisma.brand.findMany({
      where: q.q ? { name: { contains: q.q, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
      take: 50,
      select: { id: true, name: true, nameAr: true, slug: true },
    });
  }

  @ApiBearerAuth() @RequirePermissions('products.moderate') @Post('admin/brands')
  async create(@Body() dto: UpsertBrandDto, @CurrentUser() u: AuthUser) {
    const brand = await this.guard(() => this.prisma.brand.create({ data: { name: dto.name, slug: dto.slug ?? slugify(dto.name), ...brandData(dto) } }));
    await this.audit.log({ actorId: u.id, action: 'brand.create', entityType: 'Brand', entityId: brand.id });
    await this.changed([brand.slug]);
    return brand;
  }

  @ApiBearerAuth() @RequirePermissions('products.moderate') @Patch('admin/brands/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertBrandDto, @CurrentUser() u: AuthUser) {
    const before = await this.prisma.brand.findUnique({ where: { id }, select: { slug: true } });
    const brand = await this.guard(() => this.prisma.brand.update({ where: { id }, data: { name: dto.name, slug: dto.slug, ...brandData(dto) } }));
    await this.audit.log({ actorId: u.id, action: 'brand.update', entityType: 'Brand', entityId: id, before: { slug: before?.slug ?? null }, after: { slug: brand.slug, fields: Object.keys(brandData(dto)) } });
    await this.changed([before?.slug, brand.slug]);
    return brand;
  }

  private async guard<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Brand slug already exists');
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Brand not found');
      throw e;
    }
  }
}

@Module({ controllers: [BrandsController] })
export class BrandsModule {}
