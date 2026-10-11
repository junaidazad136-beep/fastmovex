import { Controller, Get, Headers, Injectable, Module, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CacheService } from '../cache/cache.service';
import { effectiveUnitPrice } from '../cart/cart.service';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { CountryService } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { VISIBLE_PRODUCT } from '../products/public-products.service';
import { StorageService } from '../storage/storage.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

import { cleanFaq, parseSeoSettings, validGtin } from './seo-rules';
export { cleanFaq, parseSeoSettings, validGtin } from './seo-rules';
export type { FaqItem, SeoSettings } from './seo-rules';

// ------------------------------------------------------------------ service

export const FEED_PAGE_SIZE = 5000;

class FeedQuery { @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) page?: number }
class AdminBrandQuery { @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string }

@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService, private readonly storage: StorageService) {}

  /**
   * Every buyable variant for Google Merchant Center (free listings and Shopping): one row per variant, grouped by
   * product, with today's price and a live deal as the sale price, stock, photos, brand, real GTINs only, and the
   * market's delivery fee and return window. The website turns it into the XML feed (one per language).
   */
  async feed(countryCode: string, page: number) {
    return this.cache.wrap(`feed:${countryCode}:${page}`, 900, async () => {
      const country = await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode }, select: { currencyCode: true, deliveryConfig: true, seoSettings: true, currency: { select: { minorUnits: true } } } });
      if (!parseSeoSettings(country.seoSettings, false).merchantFeed) return { enabled: false, items: [], page, pageSize: FEED_PAGE_SIZE, total: 0 };
      const where = { countryCode, ...VISIBLE_PRODUCT };
      const [total, products] = await Promise.all([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where, orderBy: { id: 'asc' }, skip: (page - 1) * FEED_PAGE_SIZE, take: FEED_PAGE_SIZE,
          select: {
            id: true, slug: true, title: true, titleAr: true, description: true, descriptionAr: true, shortDescription: true, shortDescriptionAr: true, returnPolicyDays: true,
            brand: { select: { name: true } },
            category: { select: { path: true } },
            store: { select: { name: true, seller: { select: { returnWindowDays: true } } } },
            images: { orderBy: { sortOrder: 'asc' }, take: 10, select: { fileKey: true, variantId: true } },
            variants: {
              where: { isActive: true },
              select: {
                id: true, sku: true, barcode: true, priceMinor: true, optionValues: true, weightGrams: true,
                inventory: { select: { onHand: true, reserved: true } },
                campaignProducts: { select: { campaignId: true, dealPriceMinor: true, stockLimit: true, soldCount: true, campaign: { select: { isActive: true, startsAt: true, endsAt: true, countryCode: true } } } },
              },
            },
          },
        }),
      ]);
      const paths = [...new Set(products.flatMap((p) => p.category.path.split('/')))];
      const names = new Map((await this.prisma.category.findMany({ where: { slug: { in: paths } }, select: { slug: true, name: true, nameAr: true } })).map((c) => [c.slug, c]));
      const now = new Date();
      const delivery = (country.deliveryConfig ?? {}) as { flatFeeMinor?: string; freeOverMinor?: string | null };
      const items = products.flatMap((p) => {
        const typeEn = p.category.path.split('/').map((s) => names.get(s)?.name ?? s).join(' > ');
        const typeAr = p.category.path.split('/').map((s) => names.get(s)?.nameAr ?? s).join(' > ');
        return p.variants.map((v) => {
          const { unit, campaignId } = effectiveUnitPrice(v, countryCode, now);
          const deal = campaignId ? v.campaignProducts.find((c) => c.campaignId === campaignId)?.campaign : null;
          const available = Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
          const own = p.images.filter((i) => i.variantId === v.id);
          const imgs = [...own, ...p.images.filter((i) => i.variantId !== v.id)].map((i) => this.storage.publicUrl(i.fileKey)).filter((u): u is string => !!u);
          const options = (v.optionValues ?? {}) as Record<string, string>;
          const opt = (re: RegExp) => Object.entries(options).find(([k]) => re.test(k))?.[1] ?? null;
          return {
            id: v.sku, itemGroupId: p.variants.length > 1 ? p.slug : null, productSlug: p.slug, variantId: v.id,
            title: p.title, titleAr: p.titleAr, options,
            description: p.description || p.shortDescription || p.title, descriptionAr: p.descriptionAr || p.shortDescriptionAr || p.titleAr || null,
            imageUrl: imgs[0] ?? null, additionalImages: imgs.slice(1, 10),
            priceMinor: v.priceMinor.toString(),
            salePriceMinor: unit < v.priceMinor ? unit.toString() : null,
            saleEndsAt: unit < v.priceMinor && deal ? deal.endsAt.toISOString() : null,
            saleStartsAt: unit < v.priceMinor && deal ? deal.startsAt.toISOString() : null,
            availability: available > 0 ? 'in_stock' : 'out_of_stock',
            brand: p.brand?.name ?? p.store.name, gtin: validGtin(v.barcode), mpn: v.sku,
            color: opt(/colou?r|لون/i), size: opt(/size|مقاس/i),
            productType: typeEn, productTypeAr: typeAr,
            weightGrams: v.weightGrams ?? null,
            returnDays: p.returnPolicyDays ?? p.store.seller.returnWindowDays,
          };
        });
      });
      return {
        enabled: true, page, pageSize: FEED_PAGE_SIZE, total, currencyCode: country.currencyCode, minorUnits: country.currency.minorUnits,
        shipping: { countryCode, flatFeeMinor: delivery.flatFeeMinor ?? '0', freeOverMinor: delivery.freeOverMinor ?? null },
        items,
      };
    });
  }

  /** A brand's own page: name in both languages, logo, text for search engines, how many products are on sale. */
  async brand(slug: string, countryCode: string) {
    return this.cache.wrap(`brand:${countryCode}:${slug}`, 120, async () => {
      const b = await this.prisma.brand.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, nameAr: true, logoKey: true, description: true, descriptionAr: true, seoTitle: true, seoTitleAr: true, seoDescription: true, seoDescriptionAr: true },
      });
      if (!b) throw new NotFoundException('Brand not found');
      const productCount = await this.prisma.product.count({ where: { brandId: b.id, countryCode, ...VISIBLE_PRODUCT } });
      const { id: _id, logoKey, ...rest } = b;
      return { ...rest, logoUrl: this.storage.publicUrl(logoKey), productCount };
    });
  }

  /** Brands with something on sale, for the sitemap. */
  async sitemapBrands(countryCode: string) {
    return this.cache.wrap(`sitemap:${countryCode}:brands`, 900, async () => {
      const rows = await this.prisma.brand.findMany({ where: { products: { some: { countryCode, ...VISIBLE_PRODUCT } } }, orderBy: { slug: 'asc' }, select: { slug: true } });
      return { items: rows.map((r) => ({ slug: r.slug, updatedAt: null })) };
    });
  }

  adminBrands(q?: string) {
    return this.prisma.brand.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAr: { contains: q } }] } : undefined,
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, nameAr: true, slug: true, description: true, descriptionAr: true, seoTitle: true, seoTitleAr: true, seoDescription: true, seoDescriptionAr: true, _count: { select: { products: true } } },
    });
  }
}

@ApiTags('Catalogue') @ApiHeader({ name: 'X-Country', required: false })
@Controller({ version: '1' })
export class SeoController {
  constructor(private readonly svc: SeoService, private readonly countries: CountryService) {}

  /** Product data for the Google Merchant Center feed (the website serves it as XML at /feeds/google-<lang>.xml). */
  @Public() @Get('feeds/products')
  async feed(@Query() q: FeedQuery, @Headers('x-country') c?: string) { return this.svc.feed((await this.countries.resolve(c)).code, q.page ?? 1); }

  @Public() @Get('brands/:slug')
  async brand(@Param('slug') slug: string, @Headers('x-country') c?: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new NotFoundException('Brand not found');
    return this.svc.brand(slug, (await this.countries.resolve(c)).code);
  }

  @Public() @Get('sitemap/brands')
  async sitemapBrands(@Headers('x-country') c?: string) { return this.svc.sitemapBrands((await this.countries.resolve(c)).code); }

  @ApiBearerAuth() @RequirePermissions('products.read') @Get('admin/brands')
  adminBrands(@Query() q: AdminBrandQuery) { return this.svc.adminBrands(q.q); }
}

@Module({ controllers: [SeoController], providers: [SeoService], exports: [SeoService] })
export class SeoModule {}
