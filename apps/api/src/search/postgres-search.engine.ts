import { Injectable, Optional } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { searchWords } from './search-text';
import { Facets, SearchEngine, SearchHits, SearchParams, Suggestions } from './search.types';

const { sql, join } = Prisma;

/** Escapes LIKE wildcards so "%" typed by a user is a literal. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** When the precise "all words" search finds fewer than this, widen to "any word". */
export const ANY_WORD_FALLBACK_BELOW = 10;

/**
 * "oud perfume" -> "'oud' | 'perfume'". Built in the app (not SQL) so Postgres sees a constant tsquery and can use
 * the GIN index. Words are Unicode letters/digits only and quoted, so no tsquery syntax can be injected. Exported for tests.
 * Words are normalised like the stored vector (Arabic letter forms). With synonyms, each word becomes a group:
 * "mobile case" + {mobile: [phone, جوال]} -> "('mobile' | 'phone' | 'جوال') & 'case'"; phrases use <-> (next word).
 */
export function anyWordQuery(q: string, mode: 'or' | 'and' = 'or', expand?: Record<string, string[]>): string | null {
  const words = searchWords(q);
  if (!words.length) return null;
  const term = (t: string) => {
    const parts = searchWords(t);
    return parts.length > 1 ? `(${parts.map((w) => `'${w}'`).join(' <-> ')})` : `'${parts[0]}'`;
  };
  const groups = words.map((w) => [w, ...(expand?.[w] ?? []).filter((t) => searchWords(t).length)].map(term));
  if (mode === 'or') return [...new Set(groups.flat())].join(' | ');
  return groups.map((g) => (g.length > 1 ? `(${g.join(' | ')})` : g[0])).join(' & ');
}

/** A barcode or SKU typed or scanned into the search box: one word of letters, digits and dashes with a digit in it. Exported for tests. */
export function codeLike(q: string | undefined): string | null {
  const v = q?.trim() ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{3,39}$/.test(v) && /\d/.test(v) ? v : null;
}

/**
 * Pure SQL builder (exported for tests). Every user value is a bound parameter — never string-concatenated.
 * Two modes: "all" = full-text, every word (fast, precise); "any" = any word + trigram typo matching (fallback). All GIN-indexed.
 */
export function buildBaseQuery(p: SearchParams): Prisma.Sql {
  const where: Prisma.Sql[] = [
    sql`p."status" = 'ACTIVE'`,
    sql`p."deletedAt" IS NULL`,
    sql`s."isActive" = true`,
    sql`se."status" = 'APPROVED'`,
    sql`p."countryCode" = ${p.countryCode}`,
  ];

  let rank: Prisma.Sql = sql`0::float8`;
  const allWords = p.q ? anyWordQuery(p.q, 'and', p.expand) : null;
  // the barcode on the pack (camera scan) or a SKU finds its product directly (both columns are indexed)
  const code = codeLike(p.q);
  const codeHit = code
    ? sql`EXISTS (SELECT 1 FROM "ProductVariant" cv WHERE cv."productId" = p."id" AND cv."isActive" = true AND (cv."barcode" = ${code} OR cv."sku" IN (${code}, ${code.toUpperCase()})))`
    : null;
  if (p.q && allWords) {
    const tsAll = sql`to_tsquery('simple', ${allWords})`;
    const tsMatch = p.matchMode === 'any' ? sql`to_tsquery('simple', ${anyWordQuery(p.q, 'or', p.expand)})` : tsAll;
    if (p.matchMode === 'any') {
      // Wide net for rare queries and typos. Every arm is GIN-indexed, so Postgres does a bitmap OR, not a scan.
      where.push(codeHit
        ? sql`(p."searchVector" @@ ${tsMatch} OR ${p.q} <% p."title" OR fastmovex_search_norm(${p.q}) <% fastmovex_search_norm(p."titleAr") OR ${codeHit})`
        : sql`(p."searchVector" @@ ${tsMatch} OR ${p.q} <% p."title" OR fastmovex_search_norm(${p.q}) <% fastmovex_search_norm(p."titleAr"))`);
    } else {
      // precise: every word present (the common, fast path)
      where.push(codeHit ? sql`(p."searchVector" @@ ${tsAll} OR ${codeHit})` : sql`p."searchVector" @@ ${tsAll}`);
    }
    // text match first; then what customers actually buy and like (best sellers, well-rated with many reviews)
    rank = sql`(ts_rank_cd(p."searchVector", ${tsAll}) * 4 + ts_rank_cd(p."searchVector", ${tsMatch})
      + word_similarity(${p.q}, p."title") + ln(1 + p."soldCount") * 0.02
      + (p."ratingAvg" / 5.0) * ln(1 + p."ratingCount") * 0.02${codeHit ? sql` + CASE WHEN ${codeHit} THEN 10 ELSE 0 END` : sql``})`;
  } else if (p.q) {
    where.push(sql`false`); // only punctuation typed: nothing can match
  }
  if (p.categoryPath) {
    where.push(sql`p."categoryId" IN (SELECT c."id" FROM "Category" c WHERE c."isActive" = true
      AND (c."path" = ${p.categoryPath} OR c."path" LIKE ${likeEscape(p.categoryPath) + '/%'}))`);
  }
  if (p.brandSlugs?.length) where.push(sql`p."brandId" IN (SELECT b."id" FROM "Brand" b WHERE b."slug" = ANY(${p.brandSlugs}))`);
  if (p.storeSlug) where.push(sql`s."slug" = ${p.storeSlug}`);
  if (p.minPrice !== undefined) where.push(sql`p."minPriceMinor" >= ${p.minPrice}`);
  if (p.maxPrice !== undefined) where.push(sql`p."minPriceMinor" <= ${p.maxPrice}`);
  if (p.minRating !== undefined) where.push(sql`p."ratingAvg" >= ${p.minRating}`);
  if (p.inStock) {
    where.push(sql`EXISTS (SELECT 1 FROM "ProductVariant" v JOIN "Inventory" i ON i."variantId" = v."id"
      WHERE v."productId" = p."id" AND v."isActive" = true AND i."onHand" - i."reserved" > 0)`);
  }

  return sql`
    SELECT p."id", p."categoryId", p."brandId", p."minPriceMinor", p."ratingAvg", p."ratingCount",
           p."soldCount", p."viewCount", p."createdAt", ${rank} AS "rank",
           EXISTS (SELECT 1 FROM "ProductVariant" v JOIN "Inventory" i ON i."variantId" = v."id"
                   WHERE v."productId" = p."id" AND v."isActive" = true AND i."onHand" - i."reserved" > 0) AS "inStock"
    FROM "Product" p
    JOIN "Store" s ON s."id" = p."storeId"
    JOIN "Seller" se ON se."id" = s."sellerId"
    WHERE ${join(where, ' AND ')}`;
}

/** ORDER BY is chosen from a fixed whitelist — sort names from the client never reach SQL. */
export function orderBy(p: SearchParams): Prisma.Sql {
  switch (p.sort) {
    case 'price_asc': return sql`b."minPriceMinor" ASC, b."id" ASC`;
    case 'price_desc': return sql`b."minPriceMinor" DESC, b."id" ASC`;
    case 'rating': return sql`b."ratingAvg" DESC, b."ratingCount" DESC, b."id" ASC`;
    case 'newest': return sql`b."createdAt" DESC, b."id" ASC`;
    case 'popular': return sql`b."soldCount" DESC, b."viewCount" DESC, b."id" ASC`;
    case 'relevance':
    default:
      // sold-out products never push buyable ones off the first page
      return p.q
        ? sql`b."inStock" DESC, b."rank" DESC, b."soldCount" DESC, b."id" ASC`
        : sql`b."inStock" DESC, b."soldCount" DESC, b."ratingCount" DESC, b."createdAt" DESC, b."id" ASC`;
  }
}

export function buildSearchQuery(p: SearchParams): Prisma.Sql {
  return sql`WITH b AS (${buildBaseQuery(p)})
    SELECT b."id", count(*) OVER()::int AS "total" FROM b
    ORDER BY ${orderBy(p)}
    LIMIT ${p.limit} OFFSET ${p.offset}`;
}

@Injectable()
export class PostgresSearchEngine extends SearchEngine {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly storage?: StorageService) {
    super();
  }

  private imageUrl(key: string | null) {
    return key && this.storage ? this.storage.publicUrl(key) : null;
  }

  async search(p: SearchParams): Promise<SearchHits> {
    const run = async (matchMode: 'all' | 'any') => {
      const rows = await this.prisma.$queryRaw<{ id: string; total: number }[]>(buildSearchQuery({ ...p, matchMode }));
      return { ids: rows.map((r) => r.id), total: rows[0]?.total ?? 0, matchMode };
    };
    const precise = await run('all');
    if (!p.q || p.matchMode === 'all') return precise;
    // Decided on the total, never on the page number, so every page of a search uses the same mode.
    // (total is 0 when this page is past the end — then check the real count before widening.)
    const total = precise.ids.length || p.offset === 0 ? precise.total : await this.count({ ...p, matchMode: 'all' });
    if (total >= ANY_WORD_FALLBACK_BELOW) return { ...precise, total };
    return run('any');
  }

  private async count(p: SearchParams): Promise<number> {
    const [row] = await this.prisma.$queryRaw<[{ n: number }]>(sql`SELECT count(*)::int AS n FROM (${buildBaseQuery(p)}) b`);
    return row?.n ?? 0;
  }

  /** Words of active products (titles and descriptions), categories and brands, with how many use each. */
  async vocabulary(): Promise<{ word: string; ndoc: number }[]> {
    return this.prisma.$queryRaw<{ word: string; ndoc: number }[]>(sql`
      SELECT word, ndoc FROM ts_stat($q$
        SELECT to_tsvector('simple', coalesce(p."title", '') || ' ' || coalesce(p."titleAr", '') || ' ' || coalesce(p."description", ''))
          FROM "Product" p WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        UNION ALL
        SELECT to_tsvector('simple', c."name" || ' ' || coalesce(c."nameAr", '')) FROM "Category" c WHERE c."isActive" = true
        UNION ALL
        SELECT to_tsvector('simple', b."name") FROM "Brand" b
      $q$)
      WHERE length(word) BETWEEN 2 AND 30 AND word !~ '[0-9]'
      ORDER BY ndoc DESC
      LIMIT 200000`);
  }

  async facets(p: SearchParams): Promise<Facets> {
    const [row] = await this.prisma.$queryRaw<[{ categories: Facets['categories'] | null; brands: Facets['brands'] | null; minMinor: string | null; maxMinor: string | null }]>(sql`
      WITH b AS (${buildBaseQuery(p)})
      SELECT
        (SELECT json_agg(x) FROM (
           SELECT c."slug", c."name", c."nameAr", count(*)::int AS "count"
           FROM b JOIN "Category" c ON c."id" = b."categoryId"
           GROUP BY c."id" ORDER BY "count" DESC LIMIT 15) x) AS "categories",
        (SELECT json_agg(y) FROM (
           SELECT br."slug", br."name", count(*)::int AS "count"
           FROM b JOIN "Brand" br ON br."id" = b."brandId"
           GROUP BY br."id" ORDER BY "count" DESC LIMIT 20) y) AS "brands",
        (SELECT min(b."minPriceMinor")::text FROM b) AS "minMinor",
        (SELECT max(b."minPriceMinor")::text FROM b) AS "maxMinor"`);
    return {
      categories: row?.categories ?? [],
      brands: row?.brands ?? [],
      price: { minMinor: row?.minMinor ?? null, maxMinor: row?.maxMinor ?? null },
    };
  }

  async suggest(q: string, countryCode: string): Promise<Suggestions> {
    const prefix = `${likeEscape(q)}%`;
    const [products, categories, brands] = await Promise.all([
      this.prisma.$queryRaw<(Suggestions['products'][number] & { imageKey: string | null })[]>(sql`
        SELECT p."slug", p."title", p."titleAr", p."minPriceMinor"::text AS "priceMinor",
               (SELECT i."fileKey" FROM "ProductImage" i WHERE i."productId" = p."id" ORDER BY i."sortOrder" ASC LIMIT 1) AS "imageKey",
               EXISTS (SELECT 1 FROM "ProductVariant" v JOIN "Inventory" inv ON inv."variantId" = v."id"
                       WHERE v."productId" = p."id" AND v."isActive" = true AND inv."onHand" - inv."reserved" > 0) AS "inStock",
               c."name" AS "category", c."nameAr" AS "categoryAr"
        FROM "Product" p
        JOIN "Category" c ON c."id" = p."categoryId"
        JOIN "Store" s ON s."id" = p."storeId" JOIN "Seller" se ON se."id" = s."sellerId"
        WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL AND s."isActive" = true AND se."status" = 'APPROVED'
          AND p."countryCode" = ${countryCode}
          AND (p."title" ILIKE ${prefix} OR ${q} <% p."title" OR fastmovex_search_norm(p."titleAr") LIKE fastmovex_search_norm(${prefix}))
        ORDER BY (p."title" ILIKE ${prefix}) DESC, word_similarity(${q}, p."title") DESC, p."soldCount" DESC
        LIMIT 6`),
      this.prisma.$queryRaw<Suggestions['categories']>(sql`
        SELECT "slug", "name", "nameAr" FROM "Category"
        WHERE "isActive" = true AND ("name" ILIKE ${'%' + likeEscape(q) + '%'} OR "nameAr" ILIKE ${'%' + likeEscape(q) + '%'})
        ORDER BY "depth" ASC, "sortOrder" ASC LIMIT 4`),
      this.prisma.$queryRaw<Suggestions['brands']>(sql`
        SELECT "slug", "name", "nameAr" FROM "Brand" WHERE "name" ILIKE ${prefix} OR coalesce("nameAr", '') ILIKE ${prefix} ORDER BY "name" LIMIT 4`),
    ]);
    return { products: products.map(({ imageKey, ...x }) => ({ ...x, imageUrl: this.imageUrl(imageKey) })), categories, brands, queries: [] };
  }
}

