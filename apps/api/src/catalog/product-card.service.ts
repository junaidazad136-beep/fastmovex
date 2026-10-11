import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** The one product-card shape used by search, home, store pages, wishlist. BigInt money is sent as string. */
export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  titleAr: string | null;
  imageUrl: string | null;
  priceMinor: string;
  compareAtMinor: string | null;
  discountPercent: number;
  currencyCode: string;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  inStock: boolean;
  lowStockCount: number | null;
  store: { slug: string; name: string; nameAr: string | null };
  isSponsored: boolean;
  /** Live campaign price for the displayed variant (the cart applies the same rule), else null. */
  dealPriceMinor: string | null;
  dealEndsAt: string | null;
  /** The variant a card's "Add" button puts in the cart: set only when the product has one option and it is in stock (otherwise the shopper picks on the product page). */
  quickAddVariantId: string | null;
}

export type LiveDealRow = { dealPriceMinor: bigint; stockLimit: number | null; soldCount: number; campaign: { endsAt: Date; countryCode: string } };

/** Cheapest live deal below the regular price, same rule as the cart. Rows must already be filtered to running campaigns. */
export function bestDeal(priceMinor: bigint, countryCode: string, rows: LiveDealRow[]): { priceMinor: bigint; endsAt: Date; stockLeft: number | null } | null {
  let best: LiveDealRow | null = null;
  for (const r of rows) {
    if (r.campaign.countryCode !== countryCode) continue;
    if (r.stockLimit !== null && r.soldCount >= r.stockLimit) continue;
    if (r.dealPriceMinor >= priceMinor) continue;
    if (!best || r.dealPriceMinor < best.dealPriceMinor) best = r;
  }
  return best ? { priceMinor: best.dealPriceMinor, endsAt: best.campaign.endsAt, stockLeft: best.stockLimit === null ? null : best.stockLimit - best.soldCount } : null;
}

/** Prisma filter for campaign rows that are running right now. */
export function liveDealsSelect(now: Date) {
  return {
    where: { campaign: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } },
    select: { dealPriceMinor: true, stockLimit: true, soldCount: true, campaign: { select: { endsAt: true, countryCode: true } } },
  } as const;
}

export function discountPercent(price: bigint, compareAt: bigint | null): number {
  if (!compareAt || compareAt <= price) return 0;
  return Number(((compareAt - price) * 100n) / compareAt);
}

type VariantRow = { priceMinor: bigint; compareAtMinor: bigint | null; currencyCode: string; inventory: { onHand: number; reserved: number; lowStockThreshold: number } | null };

/** Card shows the cheapest IN-STOCK variant; if all are out of stock, the cheapest overall. Exported for tests. */
export function pickDisplayVariant<V extends VariantRow>(variants: V[]) {
  const avail = (v: VariantRow) => Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
  const sorted = [...variants].sort((a, b) => (a.priceMinor < b.priceMinor ? -1 : a.priceMinor > b.priceMinor ? 1 : 0));
  const display = sorted.find((v) => avail(v) > 0) ?? sorted[0];
  const totalAvailable = variants.reduce((s, v) => s + avail(v), 0);
  const threshold = display?.inventory?.lowStockThreshold ?? 5;
  return { display, inStock: totalAvailable > 0, lowStockCount: totalAvailable > 0 && totalAvailable <= threshold ? totalAvailable : null };
}

@Injectable()
export class ProductCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** One query for any number of ids (no N+1). Keeps the order of `ids`; silently drops ids that are no longer visible. */
  async hydrate(ids: string[]): Promise<ProductCard[]> {
    if (!ids.length) return [];
    const nowDate = new Date();
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null, store: { isActive: true, seller: { status: 'APPROVED' } } },
      select: {
        id: true, slug: true, title: true, titleAr: true, ratingAvg: true, ratingCount: true, soldCount: true, sponsoredUntil: true, countryCode: true,
        store: { select: { slug: true, name: true, nameAr: true } },
        images: { select: { fileKey: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
        variants: {
          where: { isActive: true },
          select: {
            id: true, priceMinor: true, compareAtMinor: true, currencyCode: true, inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
            campaignProducts: liveDealsSelect(nowDate),
          },
        },
      },
    });
    const now = nowDate.getTime();
    const byId = new Map(
      rows
        .filter((r) => r.variants.length > 0)
        .map((r) => {
          const { display, inStock, lowStockCount } = pickDisplayVariant(r.variants);
          const card: ProductCard = {
            id: r.id, slug: r.slug, title: r.title, titleAr: r.titleAr,
            imageUrl: this.storage.publicUrl(r.images[0]?.fileKey),
            priceMinor: display.priceMinor.toString(),
            compareAtMinor: display.compareAtMinor?.toString() ?? null,
            discountPercent: discountPercent(display.priceMinor, display.compareAtMinor),
            currencyCode: display.currencyCode,
            ratingAvg: Math.round(r.ratingAvg * 10) / 10, ratingCount: r.ratingCount, soldCount: r.soldCount,
            inStock, lowStockCount, store: r.store,
            isSponsored: !!r.sponsoredUntil && r.sponsoredUntil.getTime() > now,
            dealPriceMinor: null, dealEndsAt: null,
            quickAddVariantId: r.variants.length === 1 && inStock ? display.id : null,
          };
          const deal = inStock ? bestDeal(display.priceMinor, r.countryCode, display.campaignProducts) : null;
          if (deal) { card.dealPriceMinor = deal.priceMinor.toString(); card.dealEndsAt = deal.endsAt.toISOString(); }
          return [r.id, card] as const;
        }),
    );
    return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
  }
}
