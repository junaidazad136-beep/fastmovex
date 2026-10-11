import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CacheService } from '../cache/cache.service';
import { ProductCard, ProductCardService } from '../catalog/product-card.service';
import { CountryInfo } from '../common/country/country.service';
import { PrismaService } from '../prisma/prisma.service';
import { SearchQueryDto } from './dto/search.dto';
import { SearchInsights } from './search-insights.service';
import { expansions } from './search-text';
import { Facets, SearchEngine, SearchHits, SearchParams, Suggestions } from './search.types';

export const MAX_RESULT_WINDOW = 1_000; // deep pages are expensive and useless; users refine instead

export interface SearchResult {
  items: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
  facets?: Facets;
  query: { q?: string; sort: string; category?: string; matchMode?: string };
  /**
   * Spelling. auto: nothing matched what was typed, so these are results for `corrected` ("Showing results for …").
   * Otherwise a suggestion that finds more ("Did you mean …?").
   */
  spelling?: { original: string; corrected: string; auto: boolean };
  /** Only when nothing was found: searches that work and best sellers, so the page is never a dead end. */
  noResults?: { popular: string[]; products: ProductCard[] };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly engine: SearchEngine,
    private readonly cards: ProductCardService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly insights: SearchInsights,
  ) {}

  /** DTO -> engine params. Exported logic kept here so every engine gets identical, validated input. */
  async toParams(dto: SearchQueryDto, country: CountryInfo): Promise<SearchParams> {
    const limit = dto.limit ?? 24;
    const page = dto.page ?? 1;
    const offset = (page - 1) * limit;
    if (offset + limit > MAX_RESULT_WINDOW) throw new BadRequestException(`Only the first ${MAX_RESULT_WINDOW} results can be browsed. Add filters to narrow down.`);

    const minPrice = dto.minPrice !== undefined ? BigInt(dto.minPrice) : undefined;
    const maxPrice = dto.maxPrice !== undefined ? BigInt(dto.maxPrice) : undefined;
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) throw new BadRequestException('minPrice cannot be greater than maxPrice');

    let categoryPath: string | undefined;
    if (dto.category) {
      const cat = await this.cache.wrap(`cat-path:${dto.category}`, 300, () =>
        this.prisma.category.findFirst({ where: { slug: dto.category, isActive: true }, select: { path: true } }),
      );
      if (!cat) throw new NotFoundException('Category not found');
      categoryPath = cat.path;
    }

    const synonyms = dto.q ? (await this.insights.settings(country.code)).synonyms : [];
    return {
      countryCode: country.code,
      q: dto.q,
      expand: dto.q ? expansions(dto.q, synonyms) : undefined,
      categoryPath,
      brandSlugs: dto.brands?.split(','),
      storeSlug: dto.store,
      minPrice,
      maxPrice,
      minRating: dto.minRating,
      inStock: dto.inStock,
      sort: dto.sort ?? 'relevance',
      limit,
      offset,
    };
  }

  async search(dto: SearchQueryDto, country: CountryInfo): Promise<SearchResult> {
    const params = await this.toParams(dto, country);
    const page = dto.page ?? 1;
    const autoCorrect = dto.spell !== false;
    // Short cache: absorbs traffic spikes on popular queries without serving stale stock for long
    const key = `search:${createHash('sha1').update(JSON.stringify({ ...params, autoCorrect }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).digest('hex')}`;

    return this.cache.wrap(key, 30, async () => {
      let hits = await this.engine.search(params);
      let used = params;
      let spelling: SearchResult['spelling'];
      // Few or only loose matches: is it a typo? (Precise matches of 10+ never pay for this.)
      if (params.q && (hits.total === 0 || hits.matchMode === 'any')) {
        const fix = await this.spell(params, hits, country, autoCorrect);
        if (fix) {
          spelling = fix.spelling;
          if (fix.hits && fix.used) { hits = fix.hits; used = fix.used; }
        }
      }
      // facets describe exactly the result set the customer sees (same match mode)
      const facets = page === 1 ? await this.engine.facets({ ...used, matchMode: hits.matchMode }) : undefined;
      const items = await this.cards.hydrate(hits.ids);
      const noResults = hits.total === 0 && page === 1 && (params.q || params.categoryPath || params.brandSlugs) ? await this.noResults(country) : undefined;
      return {
        items,
        total: hits.total,
        page,
        pageCount: Math.ceil(Math.min(hits.total, MAX_RESULT_WINDOW) / params.limit),
        facets,
        query: { q: used.q, sort: params.sort, category: dto.category, matchMode: hits.matchMode },
        ...(spelling && { spelling }),
        ...(noResults && { noResults }),
      };
    });
  }

  /**
   * Nothing at all matched what was typed but the corrected words do: show those results (auto).
   * Some loose matches, but the correction matches every word and finds more: offer it ("Did you mean …?").
   */
  private async spell(params: SearchParams, hits: SearchHits, country: CountryInfo, autoCorrect: boolean) {
    const corrected = await this.insights.correct(params.q!);
    if (!corrected || corrected === params.q!.toLowerCase()) return null;
    const synonyms = (await this.insights.settings(country.code)).synonyms;
    const fixed: SearchParams = { ...params, q: corrected, expand: expansions(corrected, synonyms) };
    if (hits.total === 0) {
      const better = await this.engine.search(fixed); // precise first, loose if needed
      if (better.total === 0) return null;
      return autoCorrect
        ? { hits: better, used: fixed, spelling: { original: params.q!, corrected, auto: true } }
        : { spelling: { original: params.q!, corrected, auto: false } };
    }
    const [better, precise] = await Promise.all([
      this.engine.search({ ...fixed, matchMode: 'all', limit: 1, offset: 0 }),
      hits.matchMode === 'any' ? this.engine.search({ ...params, matchMode: 'all', limit: 1, offset: 0 }) : Promise.resolve(hits),
    ]);
    if (precise.total === 0 && better.total > 0 && autoCorrect) {
      const page = await this.engine.search({ ...fixed, matchMode: 'all' });
      return { hits: page, used: { ...fixed, matchMode: 'all' as const }, spelling: { original: params.q!, corrected, auto: true } };
    }
    if (better.total > precise.total) return { spelling: { original: params.q!, corrected, auto: false } };
    return null;
  }

  private noResults(country: CountryInfo): Promise<NonNullable<SearchResult['noResults']>> {
    return this.cache.wrap(`search:none:${country.code}`, 300, async () => {
      const [popular, best] = await Promise.all([
        this.insights.popular(country.code, 8),
        this.engine.search({ countryCode: country.code, sort: 'popular', limit: 8, offset: 0, inStock: true }),
      ]);
      return { popular, products: await this.cards.hydrate(best.ids) };
    });
  }

  popular(country: CountryInfo) {
    return this.insights.popular(country.code, 8).then((queries) => ({ queries }));
  }

  suggest(q: string, country: CountryInfo): Promise<Suggestions> {
    return this.cache.wrap(`suggest:${country.code}:${q.toLowerCase()}`, 60, async () => {
      const [found, queries] = await Promise.all([this.engine.suggest(q, country.code), this.insights.matching(country.code, q, 4)]);
      return { ...found, queries };
    });
  }
}
