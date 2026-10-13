import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemoryCacheService, RedisCacheService } from '../src/cache/cache.service';
import { bestDeal, discountPercent, pickDisplayVariant, ProductCardService } from '../src/catalog/product-card.service';
import { CountryService } from '../src/common/country/country.service';
import { HomeService } from '../src/home/home.service';
import { PublicProductsService } from '../src/products/public-products.service';
import { anyWordQuery, buildBaseQuery, buildSearchQuery, likeEscape, orderBy, PostgresSearchEngine } from '../src/search/postgres-search.engine';
import { MAX_RESULT_WINDOW, SearchService } from '../src/search/search.service';
import { SearchParams } from '../src/search/search.types';

const base: SearchParams = { countryCode: 'QA', sort: 'relevance', limit: 24, offset: 0 };
const QA = { code: 'QA', currencyCode: 'QAR', minorUnits: 2, vatRateBps: 0, pricesIncludeTax: true, defaultLocale: 'en', deliveryConfig: {} };
const storage = { publicUrl: (k?: string | null) => (k ? `https://cdn/${k}` : null) };

describe('Search SQL builder (injection safety + correctness)', () => {
  it('user text is always a bound parameter, never inside SQL text', () => {
    const evil = `'); DROP TABLE "Product"; --`;
    const q = buildSearchQuery({ ...base, q: evil });
    expect(q.sql).not.toContain('DROP TABLE');
    expect(q.values).toContain(evil);
  });

  it('always enforces visibility + country', () => {
    const q = buildBaseQuery(base);
    for (const frag of [`p."status" = 'ACTIVE'`, `p."deletedAt" IS NULL`, `s."isActive" = true`, `se."status" = 'APPROVED'`]) expect(q.sql).toContain(frag);
    expect(q.values).toContain('QA');
  });

  it('precise mode: every word must match, via the full-text GIN index only', () => {
    const q = buildBaseQuery({ ...base, q: 'leather wallet' });
    expect(q.sql).toContain(`p."searchVector" @@ to_tsquery('simple', ?)`);
    expect(q.sql).not.toContain('<%');
    expect(q.values).toContain("'leather' & 'wallet'");
  });

  it('fallback mode: any word + trigram typo matching (all arms index-backed, no coalesce)', () => {
    const q = buildBaseQuery({ ...base, q: 'wirless chargr', matchMode: 'any' });
    expect(q.sql).toContain('<% p."title"');
    expect(q.sql).toContain('jovia_search_norm(?) <% jovia_search_norm(p."titleAr")'); // Arabic letter forms normalised, expression index
    expect(q.sql).not.toMatch(/coalesce\(p\."titleAr"/);
    expect(q.values).toContain("'wirless' | 'chargr'");
  });

  it('punctuation-only query matches nothing instead of erroring', () => {
    expect(buildBaseQuery({ ...base, q: '!!!' }).sql).toContain('false');
  });

  it('category filter includes the whole subtree and escapes LIKE wildcards', () => {
    const q = buildBaseQuery({ ...base, categoryPath: 'home_kitchen' });
    expect(q.values).toContain('home_kitchen');
    expect(q.values).toContain('home\\_kitchen/%');
  });

  it('price, rating, brand, store, stock filters add clauses with bound values', () => {
    const q = buildBaseQuery({ ...base, minPrice: 1000n, maxPrice: 5000n, minRating: 4, brandSlugs: ['apple'], storeSlug: 'doha-gadgets', inStock: true });
    expect(q.values).toEqual(expect.arrayContaining([1000n, 5000n, 4, ['apple'], 'doha-gadgets']));
    expect(q.sql).toContain('i."onHand" - i."reserved" > 0');
  });

  it('sort maps to a fixed whitelist', () => {
    expect(orderBy({ ...base, sort: 'price_asc' }).sql).toContain('"minPriceMinor" ASC');
    expect(orderBy({ ...base, sort: 'newest' }).sql).toContain('"createdAt" DESC');
    expect(orderBy({ ...base, sort: 'relevance', q: 'x' }).sql).toContain('"rank" DESC');
    expect(orderBy({ ...base, sort: 'relevance' }).sql).toContain('"soldCount" DESC');
  });

  it('likeEscape', () => expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\'));

  it('tsquery words are built safely in the app (Unicode, deduped, capped, no operators)', () => {
    expect(anyWordQuery("O'Neil's  X-12 & !(x)")).toBe("'o' | 'neil' | 's' | 'x' | '12'");
    expect(anyWordQuery('عطر عود', 'and')).toBe("'عطر' & 'عود'");
    expect(anyWordQuery('a a a')).toBe("'a'");
    expect(anyWordQuery('!!!')).toBeNull();
    expect(anyWordQuery(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '))!.split('|')).toHaveLength(12);
  });

  it('falls back to any-word only when the precise search finds fewer than 10, the same way on every page', async () => {
    const calls: string[] = [];
    const prisma = {
      $queryRaw: jest.fn(async (q: { values: unknown[]; sql: string }) => {
        const mode = q.sql.includes('<%') ? 'any' : q.sql.includes('count(*)::int AS n') ? 'count' : 'all';
        calls.push(mode);
        if (mode === 'count') return [{ n: 3 }];
        if (mode === 'all') return q.values.includes(24) && q.values.includes(24 * 5) ? [] : [{ id: 'a', total: 3 }];
        return [{ id: 'x', total: 40 }];
      }),
    };
    const engine = new PostgresSearchEngine(prisma as never);
    await expect(engine.search({ ...base, q: 'rare words' })).resolves.toMatchObject({ matchMode: 'any', total: 40 });
    calls.length = 0;
    await expect(engine.search({ ...base, q: 'rare words', offset: 24 * 5 })).resolves.toMatchObject({ matchMode: 'any' });
    expect(calls).toEqual(['all', 'count', 'any']); // past the end of precise results -> real count decides
  });
});

describe('SearchService.toParams', () => {
  const prisma = { category: { findFirst: jest.fn() } };
  const svc = new SearchService({} as never, {} as never, prisma as never, new MemoryCacheService(), { settings: async () => ({ pinned: [], hidden: [], synonyms: [] }) } as never);

  it('caps deep pagination', async () => {
    await expect(svc.toParams({ page: Math.ceil(MAX_RESULT_WINDOW / 24) + 1 }, QA)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects min > max price', async () => {
    await expect(svc.toParams({ minPrice: '500', maxPrice: '100' }, QA)).rejects.toThrow('minPrice');
  });
  it('unknown category -> 404', async () => {
    prisma.category.findFirst.mockResolvedValueOnce(null);
    await expect(svc.toParams({ category: 'nope' }, QA)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('builds params with BigInt prices, brand list and offset', async () => {
    prisma.category.findFirst.mockResolvedValueOnce({ path: 'electronics/phones' });
    const p = await svc.toParams({ q: 'case', category: 'phones', brands: 'apple,samsung', minPrice: '1000', page: 3, limit: 20, sort: 'price_asc' }, QA);
    expect(p).toMatchObject({ countryCode: 'QA', categoryPath: 'electronics/phones', brandSlugs: ['apple', 'samsung'], minPrice: 1000n, offset: 40, limit: 20, sort: 'price_asc' });
  });
});

describe('Product cards', () => {
  const inv = (onHand: number, reserved = 0) => ({ onHand, reserved, lowStockThreshold: 5 });
  it('discount %', () => {
    expect(discountPercent(7500n, 10000n)).toBe(25);
    expect(discountPercent(10000n, null)).toBe(0);
    expect(discountPercent(10000n, 9000n)).toBe(0);
  });
  it('shows cheapest IN-STOCK variant, not cheapest sold-out one', () => {
    const r = pickDisplayVariant([
      { priceMinor: 5000n, compareAtMinor: null, currencyCode: 'QAR', inventory: inv(0) },
      { priceMinor: 7000n, compareAtMinor: null, currencyCode: 'QAR', inventory: inv(20) },
    ]);
    expect(r.display.priceMinor).toBe(7000n);
    expect(r.inStock).toBe(true);
    expect(r.lowStockCount).toBeNull();
  });
  it('reserved units are not available; low stock flagged', () => {
    const r = pickDisplayVariant([{ priceMinor: 1n, compareAtMinor: null, currencyCode: 'QAR', inventory: inv(5, 2) }]);
    expect(r.lowStockCount).toBe(3);
  });
  it('hydrate keeps requested order and drops hidden products', async () => {
    const row = (id: string) => ({
      id, slug: id, title: id, titleAr: null, ratingAvg: 4.26, ratingCount: 3, soldCount: 1, sponsoredUntil: null, countryCode: 'QA',
      store: { slug: 's', name: 'S', nameAr: null }, images: [],
      variants: [{ priceMinor: 100n, compareAtMinor: 200n, currencyCode: 'QAR', inventory: inv(9), campaignProducts: [] }],
    });
    const prisma = { product: { findMany: jest.fn().mockResolvedValue([row('b'), row('a')]) } };
    const cards = await new ProductCardService(prisma as never, storage as never).hydrate(['a', 'gone', 'b']);
    expect(cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(cards[0]).toMatchObject({ priceMinor: '100', compareAtMinor: '200', discountPercent: 50, ratingAvg: 4.3, dealPriceMinor: null });
  });

  it('cards show a live deal only when it is cheaper, in the same market and not sold out (same rule as the cart)', () => {
    const ends = new Date('2030-01-01T00:00:00Z');
    const deal = (price: bigint, country = 'QA', stockLimit: number | null = null, soldCount = 0) => ({ dealPriceMinor: price, stockLimit, soldCount, campaign: { endsAt: ends, countryCode: country } });
    expect(bestDeal(100n, 'QA', [deal(80n), deal(70n)])).toEqual({ priceMinor: 70n, endsAt: ends, stockLeft: null });
    expect(bestDeal(100n, 'QA', [deal(100n), deal(120n)])).toBeNull(); // not cheaper
    expect(bestDeal(100n, 'QA', [deal(50n, 'AE')])).toBeNull(); // other market
    expect(bestDeal(100n, 'QA', [deal(50n, 'QA', 10, 10)])).toBeNull(); // deal quota used up
    expect(bestDeal(100n, 'QA', [deal(50n, 'QA', 10, 7)])).toMatchObject({ stockLeft: 3 });
  });
});

describe('Cache', () => {
  it('memory cache wraps and expires', async () => {
    const c = new MemoryCacheService();
    const fn = jest.fn().mockResolvedValue({ n: 1n });
    await c.wrap('k', 60, fn);
    await expect(c.wrap('k', 60, fn)).resolves.toEqual({ n: '1' }); // BigInt serialized
    expect(fn).toHaveBeenCalledTimes(1);
    await c.set('short', 1, -1);
    await expect(c.get('short')).resolves.toBeUndefined();
  });
  it('Redis outage degrades to cache-miss instead of breaking the site', async () => {
    const broken = { get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), set: jest.fn().mockRejectedValue(new Error('down')) };
    const c = new RedisCacheService(broken as never);
    await expect(c.wrap('k', 10, async () => 'fresh')).resolves.toBe('fresh');
  });
});

describe('CountryService', () => {
  const prisma = { country: { findMany: jest.fn().mockResolvedValue([{ code: 'QA', currencyCode: 'QAR', vatRateBps: 0, pricesIncludeTax: true, defaultLocale: 'en', currency: { minorUnits: 2 } }]) } };
  const svc = new CountryService(prisma as never, new MemoryCacheService(), { get: () => 'QA' } as never);
  it('defaults to QA', async () => expect((await svc.resolve(undefined)).currencyCode).toBe('QAR'));
  it('inactive market rejected', async () => expect(svc.resolve('ae')).rejects.toThrow('not available in AE'));
});

describe('Home feed', () => {
  const emptyPrisma = {
    banner: { findMany: jest.fn().mockResolvedValue([]) },
    campaignProduct: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    store: { findMany: jest.fn().mockResolvedValue([]) },
    recentlyViewed: { findMany: jest.fn().mockResolvedValue([]) },
    homeSection: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const engine = { search: jest.fn().mockResolvedValue({ ids: [], total: 0 }) };
  const cats = { publicTree: jest.fn().mockResolvedValue([{ slug: 'electronics', name: 'Electronics', nameAr: 'إ', iconUrl: null, children: [] }]) };
  const cards = { hydrate: jest.fn().mockResolvedValue([]) };

  it('drops empty rails; guest gets no personal sections', async () => {
    const svc = new HomeService(emptyPrisma as never, new MemoryCacheService(), cards as never, engine as never, cats as never, storage as never, { log: jest.fn() } as never);
    const feed = await svc.feed(QA);
    expect(feed.sections.map((s) => s.key)).toEqual(['value_props', 'categories']); // the promise strip needs no data
    expect(emptyPrisma.recentlyViewed.findMany).not.toHaveBeenCalled();
  });

  it('a "deal" that is not cheaper than the normal price is never shown', async () => {
    const prisma = {
      ...emptyPrisma,
      campaignProduct: { findMany: jest.fn().mockResolvedValue([{ dealPriceMinor: 12000n, stockLimit: null, soldCount: 0, campaign: { endsAt: new Date(Date.now() + 3600e3) }, variant: { productId: 'p1', isActive: true } }]) },
    };
    const c = { hydrate: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, priceMinor: '10000', inStock: true }))) };
    const svc = new HomeService(prisma as never, new MemoryCacheService(), c as never, engine as never, cats as never, storage as never, { log: jest.fn() } as never);
    const feed = await svc.feed(QA);
    expect(feed.sections.find((s) => s.key === 'flash_deals')).toBeUndefined();
  });
});

describe('View tracking', () => {
  it('counts one view per visitor per 30 min, records recently viewed', async () => {
    const prisma = { product: { update: jest.fn() }, recentlyViewed: { upsert: jest.fn() } };
    const svc = new PublicProductsService(prisma as never, storage as never, new MemoryCacheService(), {} as never);
    await svc.recordView('p1', 'u1', 'u1');
    await svc.recordView('p1', 'u1', 'u1');
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    expect(prisma.recentlyViewed.upsert).toHaveBeenCalledTimes(2);
  });
  it('never throws even if DB fails', async () => {
    const prisma = { product: { update: jest.fn().mockRejectedValue(new Error('db down')) }, recentlyViewed: { upsert: jest.fn() } };
    await expect(new PublicProductsService(prisma as never, storage as never, new MemoryCacheService(), {} as never).recordView('p', 'v')).resolves.toBeUndefined();
  });
});
