import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { bestDeal, liveDealsSelect } from '../catalog/product-card.service';
import { validGtin } from '../seo/seo-rules';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** A product is visible to customers only if product, store and seller are all live. Single definition used everywhere. */
export const VISIBLE_PRODUCT = {
  status: 'ACTIVE',
  deletedAt: null,
  store: { isActive: true, seller: { status: 'APPROVED' } },
} as const;

@Injectable()
export class PublicProductsService {
  private readonly logger = new Logger(PublicProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Counts a view at most once per visitor per 30 min (stops refresh-spam inflating "trending"),
   * and remembers it in "Recently viewed" for logged-in users. Never blocks or fails the page.
   */
  async recordView(productId: string, visitorKey: string, userId?: string): Promise<void> {
    try {
      const key = `view:${productId}:${visitorKey}`;
      if (!(await this.cache.get(key))) {
        await this.cache.set(key, 1, 1800);
        await this.prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } });
      }
      if (userId) {
        await this.prisma.recentlyViewed.upsert({
          where: { userId_productId: { userId, productId } },
          update: { viewedAt: new Date() },
          create: { userId, productId },
        });
      }
    } catch (e) {
      this.logger.warn(`recordView failed: ${(e as Error).message}`);
    }
  }

  /**
   * Product page data, micro-cached for 10 s: a popular product during a sale is read thousands of times a minute.
   * Stock and price shown can be up to 10 s old; the cart and checkout always use live values.
   */
  bySlug(slug: string) {
    return this.cache.wrap(`product:v1:${slug}`, 10, () => this.load(slug));
  }

  private async load(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, ...VISIBLE_PRODUCT },
      select: {
        id: true, slug: true, title: true, titleAr: true, description: true, descriptionAr: true, specs: true,
        shortDescription: true, shortDescriptionAr: true, seoTitle: true, seoDescription: true, tags: true,
        returnPolicyDays: true, warrantyMonths: true, ratingAvg: true, ratingCount: true, soldCount: true, minPriceMinor: true, countryCode: true,
        category: { select: { slug: true, name: true, nameAr: true, path: true } },
        brand: { select: { name: true, nameAr: true, slug: true } },
        store: { select: { slug: true, name: true, nameAr: true, logoKey: true, ratingAvg: true, ratingCount: true, seller: { select: { returnWindowDays: true } } } },
        images: { select: { id: true, fileKey: true, kind: true, altText: true, variantId: true }, orderBy: { sortOrder: 'asc' } },
        variants: {
          where: { isActive: true },
          orderBy: { priceMinor: 'asc' },
          select: {
            id: true, sku: true, optionValues: true, priceMinor: true, compareAtMinor: true, currencyCode: true, barcode: true,
            inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
            campaignProducts: liveDealsSelect(new Date()),
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found');

    const slugs = p.category.path.split('/');
    const crumbs = await this.prisma.category.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true, nameAr: true } });

    const { store, images, variants, category, ...rest } = p;
    return {
      ...rest,
      category: { slug: category.slug, name: category.name, nameAr: category.nameAr },
      breadcrumbs: slugs.map((s) => crumbs.find((c) => c.slug === s)).filter(Boolean),
      // 0 = not returnable; otherwise the product's own window or the seller's default (same rule as return requests)
      returnWindowDays: rest.returnPolicyDays ?? store.seller.returnWindowDays,
      store: { slug: store.slug, name: store.name, nameAr: store.nameAr, ratingAvg: store.ratingAvg, ratingCount: store.ratingCount, logoUrl: this.storage.publicUrl(store.logoKey) },
      images: images.map(({ fileKey, ...i }) => ({ ...i, url: this.storage.publicUrl(fileKey) })),
      variants: variants.map(({ inventory, campaignProducts, barcode, ...v }) => {
        const available = Math.max(0, (inventory?.onHand ?? 0) - (inventory?.reserved ?? 0));
        const discountPercent = v.compareAtMinor ? Number(((v.compareAtMinor - v.priceMinor) * 100n) / v.compareAtMinor) : 0;
        // Exact stock is only shown when low ("Only 3 left"), otherwise just in/out of stock
        const deal = available > 0 ? bestDeal(v.priceMinor, p.countryCode, campaignProducts) : null;
        return {
          ...v, gtin: validGtin(barcode), discountPercent, inStock: available > 0, lowStockCount: available > 0 && available <= (inventory?.lowStockThreshold ?? 5) ? available : null,
          dealPriceMinor: deal?.priceMinor ?? null, dealEndsAt: deal?.endsAt ?? null, dealStockLeft: deal?.stockLeft ?? null,
        };
      }),
    };
  }
}
