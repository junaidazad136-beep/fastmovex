import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { ProductCard, ProductCardService, pickDisplayVariant } from '../catalog/product-card.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "Frequently bought together" and "Customers also viewed" for a product page.
 * - bought together: other products in the same orders over the last year (not cancelled), most orders first
 * - also viewed: products viewed by the same signed-in shoppers, then the category's best sellers to fill the row
 * Only live, in-market products come back (the card service drops anything hidden). Cached for 30 minutes.
 */
/** A "bought together" item with the exact option the bundle adds (the one priced on the card). */
export type TogetherCard = ProductCard & { variantId: string; variantLabel: string | null };

export class RelatedProducts {
  constructor(private readonly prisma: PrismaService, private readonly cards: ProductCardService, private readonly cache: CacheService) {}

  async forProduct(product: { id: string; countryCode: string; categoryPath: string }): Promise<{ boughtTogether: TogetherCard[]; alsoViewed: ProductCard[] }> {
    return this.cache.wrap(`product:related:${product.id}`, 1800, async () => {
      const [together, viewed] = await Promise.all([this.boughtTogetherIds(product.id), this.alsoViewedIds(product.id)]).then(([a, b]) => Promise.all([this.inMarket(a, product.countryCode), this.inMarket(b, product.countryCode)]));
      const boughtTogether = await this.withVariants((await this.cards.hydrate(together)).filter((c) => c.inStock).slice(0, 2));
      const taken = new Set([product.id, ...boughtTogether.map((c) => c.id)]);
      let alsoIds = viewed.filter((id) => !taken.has(id));
      if (alsoIds.length < 8) {
        const fill = await this.prisma.product.findMany({
          where: { status: 'ACTIVE', deletedAt: null, countryCode: product.countryCode, id: { notIn: [...taken, ...alsoIds] }, category: { path: { startsWith: product.categoryPath.split('/')[0] } } },
          orderBy: [{ soldCount: 'desc' }, { ratingCount: 'desc' }],
          take: 12,
          select: { id: true },
        });
        alsoIds = [...alsoIds, ...fill.map((f) => f.id)];
      }
      const alsoViewed = (await this.cards.hydrate(alsoIds.slice(0, 16))).slice(0, 12);
      return { boughtTogether, alsoViewed };
    });
  }

  /**
   * The option each bundled item adds: the card's own (cheapest in stock) one, so the price shown is the price paid.
   * Items with options say which ("Black / 128 GB").
   */
  private async withVariants(cards: ProductCard[]): Promise<TogetherCard[]> {
    if (!cards.length) return [];
    const rows = await this.prisma.productVariant.findMany({
      where: { productId: { in: cards.map((c) => c.id) }, isActive: true },
      select: { id: true, productId: true, priceMinor: true, compareAtMinor: true, currencyCode: true, optionValues: true, inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } } },
    });
    return cards.flatMap((c) => {
      const mine = rows.filter((r) => r.productId === c.id);
      const { display, inStock } = pickDisplayVariant(mine);
      if (!display || !inStock) return [];
      const opts = display.optionValues && typeof display.optionValues === 'object' ? Object.values(display.optionValues as Record<string, unknown>).map(String).filter(Boolean) : [];
      return [{ ...c, variantId: display.id, variantLabel: mine.length > 1 && opts.length ? opts.join(' / ') : null }];
    });
  }

  /** Keeps the order of `ids`, only products sold in this market. */
  private async inMarket(ids: string[], countryCode: string): Promise<string[]> {
    if (!ids.length) return [];
    const ok = new Set((await this.prisma.product.findMany({ where: { id: { in: ids }, countryCode }, select: { id: true } })).map((p) => p.id));
    return ids.filter((id) => ok.has(id));
  }

  private async boughtTogetherIds(productId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT v2."productId" AS id
      FROM "OrderItem" a
      JOIN "ProductVariant" v1 ON v1."id" = a."variantId"
      JOIN "OrderItem" b ON b."orderId" = a."orderId" AND b."id" <> a."id"
      JOIN "ProductVariant" v2 ON v2."id" = b."variantId"
      JOIN "Order" o ON o."id" = a."orderId"
      WHERE v1."productId" = ${productId}::uuid
        AND v2."productId" <> ${productId}::uuid
        AND a."status" <> 'CANCELLED' AND b."status" <> 'CANCELLED'
        AND o."placedAt" > now() - interval '365 days'
      GROUP BY v2."productId"
      ORDER BY COUNT(DISTINCT a."orderId") DESC, MAX(o."placedAt") DESC
      LIMIT 6`);
    return rows.map((r) => r.id);
  }

  private async alsoViewedIds(productId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT b."productId" AS id
      FROM "RecentlyViewed" a
      JOIN "RecentlyViewed" b ON b."userId" = a."userId" AND b."productId" <> a."productId"
      WHERE a."productId" = ${productId}::uuid
      GROUP BY b."productId"
      ORDER BY COUNT(*) DESC, MAX(b."viewedAt") DESC
      LIMIT 16`);
    return rows.map((r) => r.id);
  }
}
