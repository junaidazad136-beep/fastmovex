import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { CampaignType, Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { ProductCard, ProductCardService } from '../catalog/product-card.service';
import { CategoriesService } from '../categories/categories.service';
import { CountryInfo } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { SearchEngine, SearchParams } from '../search/search.types';
import { StorageService } from '../storage/storage.service';
import { AuthUser } from '../common/auth-user';
import { AuditService } from '../audit/audit.service';
import { BUILTIN_KEYS, BUILTIN_SECTIONS, COLLECTION, CollectionConfig, parseCollectionConfig } from './home-layout';
import { StorefrontService } from '../common/storefront.service';

const SECTION_SIZE = 12;
const NEARBY_KM = 25;
const { sql } = Prisma;

export type DealCard = ProductCard & { dealPriceMinor: string; dealEndsAt: string; dealStockLeft: number | null };
export type StoreCard = { slug: string; name: string; nameAr: string | null; logoUrl: string | null; ratingAvg: number; ratingCount: number; distanceKm?: number };
/** Where "View all" goes for a section (the website turns it into a search / category / offers link). */
export type ViewAll = { category?: string; q?: string; sort?: string; offers?: boolean } | null;
type Common = { key: string; title?: string | null; titleAr?: string | null; viewAll?: ViewAll };
/** A home banner: the picture, where it leads, and the text the website draws on it (all optional). */
export type HomeBanner = {
  id: string; imageUrl: string | null; linkUrl: string | null; placement: string;
  kicker: string | null; kickerAr: string | null; headline: string | null; headlineAr: string | null;
  subline: string | null; sublineAr: string | null; ctaLabel: string | null; ctaLabelAr: string | null;
};
export type Section = Common & (
  | { type: 'banners'; items: HomeBanner[] }
  | { type: 'categories'; items: { slug: string; name: string; nameAr: string; iconUrl: string | null; imageUrl: string | null }[] }
  | { type: 'products'; items: ProductCard[] }
  | { type: 'deals'; items: DealCard[]; endsAt: string | null }
  | { type: 'stores'; items: StoreCard[] }
  | { type: 'value_props'; items: never[] }
);

export interface LayoutRow { id: string | null; key: string; title: string | null; titleAr: string | null; config: unknown; isActive: boolean }
export interface LayoutInput { key: string; title?: string | null; titleAr?: string | null; config?: unknown; isActive?: boolean }

@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly cards: ProductCardService,
    private readonly engine: SearchEngine,
    private readonly categories: CategoriesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  /**
   * Shared sections are cached per country for 60s (every visitor sees the same).
   * Personal sections (recently viewed, recommended, nearby) are computed per request and never cached.
   * Empty sections are dropped so the app never renders an empty rail.
   */
  async feed(country: CountryInfo, userId?: string, geo?: { lat: number; lng: number }) {
    const [shared, layout] = await Promise.all([
      this.cache.wrap(`home:${country.code}`, 60, () => this.sharedSections(country)),
      this.cache.wrap(`home:layout:${country.code}`, 60, () => this.activeLayout(country.code)),
    ]);
    const personal = await this.personalSections(country, userId, geo);
    const all = [...shared, ...personal, { key: 'value_props', type: 'value_props', items: [] } as Section];
    const keep = (s: Section | undefined): s is Section => !!s && (s.type === 'value_props' || s.items.length > 0);

    // No layout saved in the admin panel: the built-in order.
    if (!layout.length) {
      return { country: country.code, currencyCode: country.currencyCode, sections: BUILTIN_KEYS.map((k) => all.find((s) => s.key === k)).filter(keep) };
    }

    const sections: Section[] = [];
    for (const row of layout) {
      const titles = { title: row.title, titleAr: row.titleAr };
      if (row.key === COLLECTION) {
        const col = await this.cache.wrap(`home:col:${row.id}`, 60, () => this.collection(country, row.config));
        if (col.items.length) sections.push({ key: `collection_${row.id}`, type: 'products', items: col.items, viewAll: col.viewAll, ...titles });
        continue;
      }
      const s = all.find((x) => x.key === row.key);
      if (keep(s)) sections.push({ ...s, ...(row.title ? { title: row.title } : {}), ...(row.titleAr ? { titleAr: row.titleAr } : {}) });
    }
    return { country: country.code, currencyCode: country.currencyCode, sections };
  }

  // ------------------------------------------------------------ layout (admin)

  private async activeLayout(countryCode: string) {
    return this.prisma.homeSection.findMany({ where: { countryCode, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, key: true, title: true, titleAr: true, config: true } });
  }

  /** The layout as the admin panel edits it: saved rows, or the built-in default when nothing is saved yet. */
  async layout(countryCode: string) {
    const rows = await this.prisma.homeSection.findMany({ where: { countryCode }, orderBy: { sortOrder: 'asc' } });
    const sections: LayoutRow[] = rows.length
      ? rows.map((r) => ({ id: r.id, key: r.key, title: r.title, titleAr: r.titleAr, config: r.config, isActive: r.isActive }))
      : BUILTIN_KEYS.map((key) => ({ id: null, key, title: null, titleAr: null, config: {}, isActive: true }));
    return { countryCode, custom: rows.length > 0, sections, builtins: BUILTIN_SECTIONS };
  }

  /** Replaces the whole layout at once (the order given is the order shown). */
  async saveLayout(countryCode: string, input: LayoutInput[], actor: AuthUser) {
    if (input.length > 40) throw new BadRequestException('At most 40 sections');
    const seen = new Set<string>();
    const rows = [];
    for (const [i, s] of input.entries()) {
      if (s.key !== COLLECTION && !BUILTIN_KEYS.includes(s.key)) throw new BadRequestException(`Unknown section "${s.key}"`);
      if (s.key !== COLLECTION) {
        if (seen.has(s.key)) throw new BadRequestException(`"${s.key}" is in the list twice`);
        seen.add(s.key);
      }
      let config: CollectionConfig | Record<string, never> = {};
      if (s.key === COLLECTION) {
        config = parseCollectionConfig(s.config);
        if (config.categoryId && !(await this.prisma.category.findUnique({ where: { id: config.categoryId }, select: { id: true } }))) {
          throw new BadRequestException('Collection: that category no longer exists');
        }
        if (!s.title?.trim()) throw new BadRequestException('Give each collection a title');
      }
      const clean = (v?: string | null) => (v && v.trim() ? v.trim().slice(0, 80) : null);
      rows.push({ countryCode, key: s.key, title: clean(s.title), titleAr: clean(s.titleAr), config: config as object, sortOrder: i, isActive: s.isActive !== false });
    }
    const old = await this.prisma.homeSection.findMany({ where: { countryCode }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.homeSection.deleteMany({ where: { countryCode } }),
      this.prisma.homeSection.createMany({ data: rows }),
    ]);
    await this.cache.del(`home:layout:${countryCode}`, `home:${countryCode}`, ...old.map((o) => `home:col:${o.id}`));
    this.storefront?.refresh('home');
    await this.audit.log({ actorId: actor.id, action: 'home.layout_saved', entityType: 'Country', entityId: countryCode, after: { sections: rows.map((r) => r.key) } });
    return this.layout(countryCode);
  }

  /** Back to the built-in layout. */
  async resetLayout(countryCode: string, actor: AuthUser) {
    const old = await this.prisma.homeSection.findMany({ where: { countryCode }, select: { id: true } });
    await this.prisma.homeSection.deleteMany({ where: { countryCode } });
    await this.cache.del(`home:layout:${countryCode}`, ...old.map((o) => `home:col:${o.id}`));
    this.storefront?.refresh('home');
    await this.audit.log({ actorId: actor.id, action: 'home.layout_reset', entityType: 'Country', entityId: countryCode });
    return this.layout(countryCode);
  }

  /** What a collection would show right now (the admin preview). */
  async previewCollection(country: CountryInfo, raw: unknown) {
    return this.collection(country, parseCollectionConfig(raw));
  }

  private async collection(country: CountryInfo, raw: unknown): Promise<{ items: ProductCard[]; viewAll: ViewAll }> {
    let c: CollectionConfig;
    try { c = parseCollectionConfig(raw); } catch { return { items: [], viewAll: null }; }
    const limit = c.limit ?? 12;
    const live: Prisma.ProductWhereInput = { countryCode: country.code, status: 'ACTIVE', deletedAt: null, store: { isActive: true, seller: { status: 'APPROVED' } } };
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      c.sort === 'newest' ? [{ createdAt: 'desc' }] : c.sort === 'price_asc' ? [{ minPriceMinor: 'asc' }] : c.sort === 'price_desc' ? [{ minPriceMinor: 'desc' }] : [{ soldCount: 'desc' }, { ratingAvg: 'desc' }];

    if (c.source === 'products') {
      const rows = await this.prisma.product.findMany({ where: { ...live, id: { in: c.productIds } }, select: { id: true } });
      const ok = new Set(rows.map((r) => r.id));
      return { items: await this.cards.hydrate(c.productIds!.filter((id) => ok.has(id)).slice(0, limit)), viewAll: null };
    }
    let where: Prisma.ProductWhereInput = live;
    let viewAll: ViewAll = null;
    if (c.source === 'category') {
      const cat = await this.prisma.category.findUnique({ where: { id: c.categoryId }, select: { path: true, slug: true, isActive: true } });
      if (!cat?.isActive) return { items: [], viewAll: null };
      where = { ...live, category: { path: { startsWith: cat.path } } };
      viewAll = { category: cat.slug, ...(c.sort && c.sort !== 'popular' ? { sort: c.sort } : {}) };
    } else if (c.source === 'tag') {
      where = { ...live, tags: { has: c.tag } };
    } else {
      const ids = await this.saleIds(country.code, limit * 3);
      where = { ...live, id: { in: ids } };
      viewAll = { offers: true };
    }
    const rows = await this.prisma.product.findMany({ where, orderBy, take: limit * 2, select: { id: true } });
    const items = (await this.cards.hydrate(rows.map((r) => r.id))).filter((p) => p.inStock).slice(0, limit);
    return { items, viewAll };
  }

  /** Products with a variant priced below its "was" price, biggest discount first. */
  private async saleIds(countryCode: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(sql`
      SELECT p."id" FROM "Product" p
      JOIN "ProductVariant" v ON v."productId" = p."id" AND v."isActive" AND v."compareAtMinor" > v."priceMinor"
      JOIN "Store" s ON s."id" = p."storeId" JOIN "Seller" se ON se."id" = s."sellerId"
      WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL AND s."isActive" AND se."status" = 'APPROVED' AND p."countryCode" = ${countryCode}
      GROUP BY p."id"
      ORDER BY max((v."compareAtMinor" - v."priceMinor")::float8 / v."compareAtMinor") DESC, p."soldCount" DESC
      LIMIT ${limit}`);
    return rows.map((r) => r.id);
  }

  /** The Offers page: every live campaign with its deals, then everything else on sale. */
  async offers(country: CountryInfo) {
    return this.cache.wrap(`offers:${country.code}`, 60, async () => {
      const now = new Date();
      const campaigns = await this.prisma.campaign.findMany({
        where: { countryCode: country.code, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: { endsAt: 'asc' },
        take: 10,
        select: { id: true, name: true, nameAr: true, type: true, endsAt: true },
      });
      const withDeals = await Promise.all(campaigns.map(async (c) => ({ ...c, endsAt: c.endsAt.toISOString(), items: (await this.campaignDeals(country.code, c.type, c.id)).items })));
      const inCampaign = new Set(withDeals.flatMap((c) => c.items.map((i) => i.id)));
      const sale = (await this.cards.hydrate(await this.saleIds(country.code, 60))).filter((p) => p.inStock && !inCampaign.has(p.id)).slice(0, 48);
      return { currencyCode: country.currencyCode, campaigns: withDeals.filter((c) => c.items.length), sale };
    });
  }

  async recentlyViewed(userId: string, limit = SECTION_SIZE): Promise<ProductCard[]> {
    const rows = await this.prisma.recentlyViewed.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, take: limit, select: { productId: true } });
    return this.cards.hydrate(rows.map((r) => r.productId));
  }

  // ------------------------------------------------------------------ shared

  private async sharedSections(country: CountryInfo): Promise<Section[]> {
    const base: Omit<SearchParams, 'sort'> = { countryCode: country.code, inStock: true, limit: SECTION_SIZE, offset: 0 };
    const [banners, tree, flash, exclusive, featured, sponsored, trending, best, fresh, stores, photos] = await Promise.all([
      this.banners(country.code),
      this.categories.publicTree(),
      this.campaignDeals(country.code, 'FLASH_DEAL'),
      this.campaignDeals(country.code, 'JOVIA_EXCLUSIVE'),
      this.flagged(country.code, { isFeatured: true }),
      this.flagged(country.code, { sponsoredUntil: { gt: new Date() } }),
      this.trendingIds(country.code),
      this.engine.search({ ...base, sort: 'popular' }),
      this.engine.search({ ...base, sort: 'newest' }),
      this.featuredStores(country.code),
      this.categoryPhotos(country.code),
    ]);

    const [featuredCards, sponsoredCards, trendingCards, bestCards, freshCards] = await Promise.all(
      [featured, sponsored, trending, best.ids, fresh.ids].map((ids) => this.cards.hydrate(ids)),
    );

    return [
      { key: 'hero', type: 'banners', items: banners.filter((b) => b.placement === 'HOME_HERO') },
      { key: 'promo', type: 'banners', items: banners.filter((b) => b.placement === 'HOME_MID') },
      { key: 'categories', type: 'categories', items: tree.map(({ slug, name, nameAr, iconUrl, imageUrl }) => ({ slug, name, nameAr, iconUrl, imageUrl: imageUrl ?? photos.get(slug) ?? null })) },
      { key: 'flash_deals', type: 'deals', ...flash, viewAll: { offers: true } },
      { key: 'jovia_exclusive', type: 'deals', ...exclusive },
      { key: 'featured', type: 'products', items: featuredCards },
      { key: 'sponsored', type: 'products', items: sponsoredCards },
      { key: 'trending', type: 'products', items: trendingCards },
      { key: 'best_sellers', type: 'products', items: bestCards, viewAll: { sort: 'popular' } },
      { key: 'new_arrivals', type: 'products', items: freshCards, viewAll: { sort: 'newest' } },
      { key: 'featured_sellers', type: 'stores', items: stores },
    ];
  }

  private async banners(countryCode: string) {
    const now = new Date();
    const rows = await this.prisma.banner.findMany({
      where: {
        countryCode, isActive: true, placement: { in: ['HOME_HERO', 'HOME_MID'] },
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: { sortOrder: 'asc' },
      take: 20,
      select: { id: true, imageKey: true, linkUrl: true, placement: true, kicker: true, kickerAr: true, headline: true, headlineAr: true, subline: true, sublineAr: true, ctaLabel: true, ctaLabelAr: true },
    });
    return rows.map(({ imageKey, ...b }): HomeBanner => ({ ...b, imageUrl: this.storage.publicUrl(imageKey) }));
  }

  /**
   * A photo for each top-level category tile: the first picture of its best-selling product on sale in this market
   * (categories have small icons, not photos). One query for all categories.
   */
  private async categoryPhotos(countryCode: string): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<{ root: string; fileKey: string }[]>`
      SELECT DISTINCT ON (root) root, "fileKey" FROM (
        SELECT split_part(c."path", '/', 1) AS root, i."fileKey", p."soldCount", p."ratingCount", p."id"
        FROM "Product" p
        JOIN "Category" c ON c."id" = p."categoryId"
        JOIN "Store" s ON s."id" = p."storeId" AND s."isActive" = true
        JOIN "Seller" se ON se."id" = s."sellerId" AND se."status" = 'APPROVED'
        JOIN LATERAL (SELECT "fileKey" FROM "ProductImage" WHERE "productId" = p."id" ORDER BY "sortOrder" ASC LIMIT 1) i ON true
        WHERE p."countryCode" = ${countryCode} AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
      ) x
      ORDER BY root, "soldCount" DESC, "ratingCount" DESC, "id"`;
    const out = new Map<string, string>();
    for (const r of rows) {
      const url = this.storage.publicUrl(r.fileKey);
      if (url) out.set(r.root, url);
    }
    return out;
  }

  /** Deal price shown here is informational; the cart re-checks the campaign server-side before charging. */
  private async campaignDeals(countryCode: string, type: CampaignType, campaignId?: string): Promise<{ items: DealCard[]; endsAt: string | null }> {
    const now = new Date();
    const deals = await this.prisma.campaignProduct.findMany({
      where: { ...(campaignId && { campaignId }), campaign: { countryCode, type, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } },
      orderBy: { soldCount: 'desc' },
      take: SECTION_SIZE * 2,
      select: {
        dealPriceMinor: true, stockLimit: true, soldCount: true,
        campaign: { select: { endsAt: true } },
        variant: { select: { productId: true, isActive: true } },
      },
    });
    const live = deals.filter((d) => d.variant.isActive && (d.stockLimit === null || d.soldCount < d.stockLimit));
    const best = new Map<string, (typeof live)[number]>();
    for (const d of live) {
      const cur = best.get(d.variant.productId);
      if (!cur || d.dealPriceMinor < cur.dealPriceMinor) best.set(d.variant.productId, d);
    }
    const cards = await this.cards.hydrate([...best.keys()].slice(0, SECTION_SIZE));
    const items = cards
      .map((c) => {
        const d = best.get(c.id)!;
        return { ...c, dealPriceMinor: d.dealPriceMinor.toString(), dealEndsAt: d.campaign.endsAt.toISOString(), dealStockLeft: d.stockLimit === null ? null : d.stockLimit - d.soldCount };
      })
      .filter((c) => c.inStock && BigInt(c.dealPriceMinor) < BigInt(c.priceMinor)); // never show a "deal" that is not cheaper
    const endsAt = items.length ? items.map((i) => i.dealEndsAt).sort()[0] : null;
    return { items, endsAt };
  }

  private async flagged(countryCode: string, where: Prisma.ProductWhereInput): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { ...where, countryCode, status: 'ACTIVE', deletedAt: null, store: { isActive: true, seller: { status: 'APPROVED' } } },
      orderBy: [{ soldCount: 'desc' }, { createdAt: 'desc' }],
      take: SECTION_SIZE,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Trending = sales and views weighted toward products added in the last 60 days. */
  private async trendingIds(countryCode: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(sql`
      SELECT p."id" FROM "Product" p
      JOIN "Store" s ON s."id" = p."storeId" JOIN "Seller" se ON se."id" = s."sellerId"
      WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL AND s."isActive" = true AND se."status" = 'APPROVED'
        AND p."countryCode" = ${countryCode} AND p."createdAt" > now() - interval '60 days'
        AND (p."soldCount" > 0 OR p."viewCount" > 0)
      ORDER BY (p."soldCount" * 5 + p."viewCount") DESC, p."createdAt" DESC
      LIMIT ${SECTION_SIZE}`);
    return rows.map((r) => r.id);
  }

  private async featuredStores(countryCode: string): Promise<StoreCard[]> {
    const rows = await this.prisma.store.findMany({
      where: { isFeatured: true, isActive: true, seller: { status: 'APPROVED', countryCode } },
      orderBy: [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }],
      take: SECTION_SIZE,
      select: { slug: true, name: true, nameAr: true, logoKey: true, ratingAvg: true, ratingCount: true },
    });
    return rows.map(({ logoKey, ...s }) => ({ ...s, logoUrl: this.storage.publicUrl(logoKey) }));
  }

  // ---------------------------------------------------------------- personal

  private async personalSections(country: CountryInfo, userId?: string, geo?: { lat: number; lng: number }): Promise<Section[]> {
    const out: Section[] = [];
    if (geo) out.push({ key: 'nearby_sellers', type: 'stores', items: await this.nearbyStores(country.code, geo) });
    if (!userId) return out;

    const viewed = await this.prisma.recentlyViewed.findMany({
      where: { userId, product: { countryCode: country.code } },
      orderBy: { viewedAt: 'desc' },
      take: 30,
      select: { productId: true, product: { select: { categoryId: true } } },
    });
    if (!viewed.length) return out;

    out.push({ key: 'recently_viewed', type: 'products', items: await this.cards.hydrate(viewed.slice(0, SECTION_SIZE).map((v) => v.productId)) });

    // "Recommended for you": popular in-stock products from the categories this user looks at, excluding what they've seen
    const cats = [...new Set(viewed.map((v) => v.product.categoryId))].slice(0, 5);
    const seen = viewed.map((v) => v.productId);
    const rec = await this.prisma.product.findMany({
      where: {
        categoryId: { in: cats }, id: { notIn: seen }, countryCode: country.code, status: 'ACTIVE', deletedAt: null,
        store: { isActive: true, seller: { status: 'APPROVED' } },
      },
      orderBy: [{ soldCount: 'desc' }, { ratingAvg: 'desc' }],
      take: SECTION_SIZE,
      select: { id: true },
    });
    out.push({ key: 'recommended', type: 'products', items: (await this.cards.hydrate(rec.map((r) => r.id))).filter((c) => c.inStock) });
    return out;
  }

  /** Haversine distance in SQL; only stores that set their location. */
  private async nearbyStores(countryCode: string, { lat, lng }: { lat: number; lng: number }): Promise<StoreCard[]> {
    const rows = await this.prisma.$queryRaw<(Omit<StoreCard, 'logoUrl'> & { logoKey: string | null })[]>(sql`
      SELECT * FROM (
        SELECT st."slug", st."name", st."nameAr", st."logoKey", st."ratingAvg", st."ratingCount",
          round((6371 * acos(least(1, cos(radians(${lat})) * cos(radians(st."lat")) * cos(radians(st."lng") - radians(${lng}))
            + sin(radians(${lat})) * sin(radians(st."lat")))))::numeric, 1)::float8 AS "distanceKm"
        FROM "Store" st JOIN "Seller" se ON se."id" = st."sellerId"
        WHERE st."isActive" = true AND se."status" = 'APPROVED' AND se."countryCode" = ${countryCode}
          AND st."lat" IS NOT NULL AND st."lng" IS NOT NULL
      ) x WHERE x."distanceKm" <= ${NEARBY_KM}
      ORDER BY x."distanceKm" ASC LIMIT ${SECTION_SIZE}`);
    return rows.map(({ logoKey, ...s }) => ({ ...s, logoUrl: this.storage.publicUrl(logoKey) }));
  }
}
