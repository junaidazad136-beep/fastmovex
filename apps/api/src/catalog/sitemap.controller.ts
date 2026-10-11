import { Controller, Get, Headers, Injectable, Query } from '@nestjs/common';
import { ApiHeader, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CacheService } from '../cache/cache.service';
import { Public } from '../common/decorators/auth.decorators';
import { CountryService } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VISIBLE_PRODUCT } from '../products/public-products.service';

export const SITEMAP_PAGE_SIZE = 10_000;

class SitemapQuery {
  @ApiPropertyOptional({ enum: ['products', 'categories', 'stores'] }) @IsOptional() @IsIn(['products', 'categories', 'stores']) kind?: 'products' | 'categories' | 'stores';
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
}

/** Slugs + last-modified dates for the website's sitemap.xml. Only what a visitor can actually open is listed. */
@Injectable()
export class SitemapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  async summary(countryCode: string) {
    return this.cache.wrap(`sitemap:summary:${countryCode}`, 900, async () => {
      const products = await this.prisma.product.count({ where: { countryCode, ...VISIBLE_PRODUCT } });
      return { pageSize: SITEMAP_PAGE_SIZE, productPages: Math.max(1, Math.ceil(products / SITEMAP_PAGE_SIZE)), products };
    });
  }

  async page(countryCode: string, kind: 'products' | 'categories' | 'stores', page: number) {
    return this.cache.wrap(`sitemap:${countryCode}:${kind}:${page}`, 900, async () => {
      if (kind === 'categories') {
        const rows = await this.prisma.category.findMany({ where: { isActive: true }, orderBy: { path: 'asc' }, select: { slug: true, updatedAt: true } });
        return { items: rows };
      }
      if (kind === 'stores') {
        const rows = await this.prisma.store.findMany({
          where: { isActive: true, seller: { status: 'APPROVED', countryCode } },
          orderBy: { createdAt: 'asc' },
          select: { slug: true, updatedAt: true },
        });
        return { items: rows };
      }
      const rows = await this.prisma.product.findMany({
        where: { countryCode, ...VISIBLE_PRODUCT },
        orderBy: { id: 'asc' },
        skip: (page - 1) * SITEMAP_PAGE_SIZE,
        take: SITEMAP_PAGE_SIZE,
        select: { slug: true, updatedAt: true, title: true, titleAr: true, images: { where: { kind: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 3, select: { fileKey: true } } },
      });
      // photos go into the image sitemap (Google Images is a real source of shoppers)
      return { items: rows.map(({ images, ...r }) => ({ ...r, images: images.map((i) => this.storage.publicUrl(i.fileKey)).filter(Boolean) })) };
    });
  }
}

@ApiTags('Catalogue')
@ApiHeader({ name: 'X-Country', required: false })
@Controller({ path: 'sitemap', version: '1' })
export class SitemapController {
  constructor(
    private readonly svc: SitemapService,
    private readonly countries: CountryService,
  ) {}

  @Public() @Get()
  async get(@Query() q: SitemapQuery, @Headers('x-country') country?: string) {
    const c = await this.countries.resolve(country);
    if (!q.kind) return this.svc.summary(c.code);
    return this.svc.page(c.code, q.kind, q.page ?? 1);
  }
}
