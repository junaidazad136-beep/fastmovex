import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { logKey, normalizeSearch, readSearchSettings, SearchSettings, Vocabulary } from './search-text';
import { SearchEngine } from './search.types';

const { sql, join } = Prisma;

/** A search becomes "popular" once this many different visitors used it (keeps one person's typing out). */
export const POPULAR_MIN_VISITORS = 3;
/** Popular searches look at this many days. */
export const POPULAR_DAYS = 30;
const VOCABULARY_TTL_MS = 10 * 60_000;

interface Bucket { countryCode: string; day: string; query: string; searches: number; visitors: number; zeroResults: number; corrected: number; lastTotal: number }

/**
 * What customers search for: a counted log (no user ids, nothing that looks like personal data), popular searches
 * for the search box, the catalogue vocabulary for spelling suggestions, and the staff report.
 * Searches are counted in memory and written in batches, so logging never slows a search down.
 */
@Injectable()
export class SearchInsights implements OnModuleDestroy {
  private readonly logger = new Logger(SearchInsights.name);
  private buffer = new Map<string, Bucket>();
  private seen = new Set<string>();
  private seenDay = '';
  private vocab: Vocabulary | null = null;
  private vocabAt = 0;
  private vocabLoading: Promise<Vocabulary> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly engine: SearchEngine,
  ) {}

  // ---------------------------------------------------------------- log

  /** Counts one search. `visitor` (IP + browser) is only hashed in memory to count distinct visitors per day. */
  record(countryCode: string, q: string, total: number, corrected: boolean, visitor: string, now = new Date()): boolean {
    const query = logKey(q);
    if (!query) return false;
    const day = now.toISOString().slice(0, 10);
    if (day !== this.seenDay) { this.seen.clear(); this.seenDay = day; }
    const v = createHash('sha256').update(`${day}|${visitor}|${countryCode}|${query}`).digest('base64url').slice(0, 16);
    const isNew = !this.seen.has(v);
    if (isNew && this.seen.size < 200_000) this.seen.add(v);
    const key = `${countryCode}|${day}|${query}`;
    const b = this.buffer.get(key) ?? { countryCode, day, query, searches: 0, visitors: 0, zeroResults: 0, corrected: 0, lastTotal: 0 };
    b.searches++;
    if (isNew) b.visitors++;
    if (total === 0) b.zeroResults++;
    if (corrected) b.corrected++;
    b.lastTotal = Math.max(0, Math.min(Math.trunc(total) || 0, 1_000_000));
    this.buffer.set(key, b);
    if (this.buffer.size >= 5_000) void this.flush();
    return true;
  }

  @Interval(30_000)
  async flush(): Promise<number> {
    if (!this.buffer.size) return 0;
    const rows = [...this.buffer.values()];
    this.buffer = new Map();
    try {
      for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) =>
          sql`(${r.countryCode}, ${r.day}::date, ${r.query}, ${r.searches}, ${r.visitors}, ${r.zeroResults}, ${r.corrected}, ${r.lastTotal})`);
        await this.prisma.$executeRaw(sql`
          INSERT INTO "SearchLog" ("countryCode", "day", "query", "searches", "visitors", "zeroResults", "corrected", "lastTotal")
          VALUES ${join(values)}
          ON CONFLICT ("countryCode", "day", "query") DO UPDATE SET
            "searches" = "SearchLog"."searches" + EXCLUDED."searches",
            "visitors" = "SearchLog"."visitors" + EXCLUDED."visitors",
            "zeroResults" = "SearchLog"."zeroResults" + EXCLUDED."zeroResults",
            "corrected" = "SearchLog"."corrected" + EXCLUDED."corrected",
            "lastTotal" = EXCLUDED."lastTotal"`);
      }
    } catch (e) {
      this.logger.warn(`search log not saved: ${(e as Error).message}`);
    }
    return rows.length;
  }

  async onModuleDestroy() { await this.flush(); }

  // ---------------------------------------------------------------- settings & popular searches

  settings(countryCode: string): Promise<SearchSettings> {
    return this.cache.wrap(`search:settings:${countryCode}`, 60, async () => {
      const c = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { searchSettings: true } });
      return readSearchSettings(c?.searchSettings);
    });
  }

  /** Searches many visitors used lately that still find something, most used first. */
  private pool(countryCode: string): Promise<string[]> {
    return this.cache.wrap(`search:popular:${countryCode}`, 600, async () => {
      const from = new Date(Date.now() - POPULAR_DAYS * 86_400_000);
      const rows = await this.prisma.$queryRaw<{ query: string; last: number }[]>(sql`
        SELECT "query", (array_agg("lastTotal" ORDER BY "day" DESC))[1] AS "last"
        FROM "SearchLog" WHERE "countryCode" = ${countryCode} AND "day" >= ${from}::date
        GROUP BY "query" HAVING sum("visitors") >= ${POPULAR_MIN_VISITORS}
        ORDER BY sum("visitors") DESC, sum("searches") DESC LIMIT 300`);
      return rows.filter((r) => r.last > 0).map((r) => r.query);
    });
  }

  async popular(countryCode: string, n = 8): Promise<string[]> {
    const [s, pool] = await Promise.all([this.settings(countryCode), this.pool(countryCode)]);
    const hidden = new Set(s.hidden);
    const out: string[] = [];
    for (const q of [...s.pinned, ...pool]) {
      const k = logKey(q) ?? q.toLowerCase();
      if (hidden.has(k) || out.some((o) => o.toLowerCase() === q.toLowerCase())) continue;
      out.push(q);
      if (out.length >= n) break;
    }
    // A new shop has no search history yet: show its best-selling brands instead of an empty row
    if (out.length < Math.min(4, n)) {
      for (const name of await this.topBrands(countryCode, n)) {
        if (out.length >= n) break;
        if (hidden.has(name.toLowerCase()) || out.some((o) => o.toLowerCase() === name.toLowerCase())) continue;
        out.push(name);
      }
    }
    return out;
  }

  /** Brands of the products that sell most in this market (cached with the popular searches). */
  private topBrands(countryCode: string, n: number): Promise<string[]> {
    return this.cache.wrap(`search:topBrands:${countryCode}`, 600, async () => {
      const rows = await this.prisma.$queryRaw<{ name: string }[]>`
        SELECT b."name" FROM "Brand" b
        JOIN "Product" p ON p."brandId" = b."id" AND p."countryCode" = ${countryCode} AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        GROUP BY b."id", b."name" ORDER BY SUM(p."soldCount") DESC, COUNT(*) DESC, b."name" LIMIT ${n}`;
      return rows.map((r) => r.name).filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    });
  }

  /** Popular searches that start like what is being typed (any of their words), for the search box. */
  async matching(countryCode: string, typed: string, n = 4): Promise<string[]> {
    const t = normalizeSearch(typed.trim());
    if (t.length < 2) return [];
    const [s, pool] = await Promise.all([this.settings(countryCode), this.pool(countryCode)]);
    const hidden = new Set(s.hidden);
    return [...s.pinned.map((p) => p.toLowerCase()), ...pool]
      .filter((q, i, all) => all.indexOf(q) === i && !hidden.has(q))
      .filter((q) => { const nq = normalizeSearch(q); return nq !== t && (nq.startsWith(t) || nq.includes(` ${t}`)); })
      .slice(0, n);
  }

  /** Drop cached settings and popular searches after staff change them. */
  async forget(countryCode: string) {
    await this.cache.del(`search:settings:${countryCode}`, `search:popular:${countryCode}`);
  }

  // ---------------------------------------------------------------- spelling

  /** Catalogue words, reloaded every 10 minutes in the background (searches use the previous list meanwhile). */
  async vocabulary(): Promise<Vocabulary> {
    const stale = Date.now() - this.vocabAt > VOCABULARY_TTL_MS;
    if (this.vocab && !stale) return this.vocab;
    this.vocabLoading ??= this.engine.vocabulary()
      .then((rows) => { this.vocab = new Vocabulary(rows); this.vocabAt = Date.now(); return this.vocab; })
      .catch((e) => { this.logger.warn(`search vocabulary not loaded: ${(e as Error).message}`); this.vocabAt = Date.now(); return this.vocab ?? new Vocabulary([]); })
      .finally(() => { this.vocabLoading = null; });
    return this.vocab ?? this.vocabLoading;
  }

  /** Drops the word list (tests, or right after a big catalogue import). */
  resetVocabulary() { this.vocab = null; this.vocabAt = 0; }

  async correct(q: string): Promise<string | null> {
    return (await this.vocabulary()).correctQuery(q);
  }

  // ---------------------------------------------------------------- report

  async report(countryCode: string, days: number, now = new Date()) {
    await this.flush();
    const from = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const [totals, daily, top, zero, settings] = await Promise.all([
      this.prisma.$queryRaw<[{ searches: number; visitors: number; zero: number; corrected: number; distinct: number }]>(sql`
        SELECT coalesce(sum("searches"), 0)::int AS searches, coalesce(sum("visitors"), 0)::int AS visitors,
               coalesce(sum("zeroResults"), 0)::int AS zero, coalesce(sum("corrected"), 0)::int AS corrected,
               count(DISTINCT "query")::int AS distinct
        FROM "SearchLog" WHERE "countryCode" = ${countryCode} AND "day" >= ${from}::date`),
      this.prisma.$queryRaw<{ day: string; searches: number; zero: number }[]>(sql`
        SELECT to_char("day", 'YYYY-MM-DD') AS day, sum("searches")::int AS searches, sum("zeroResults")::int AS zero
        FROM "SearchLog" WHERE "countryCode" = ${countryCode} AND "day" >= ${from}::date
        GROUP BY "day" ORDER BY "day"`),
      this.rows(countryCode, from, sql`ORDER BY sum("visitors") DESC, sum("searches") DESC`),
      this.rows(countryCode, from, sql`HAVING sum("zeroResults") > 0 ORDER BY sum("zeroResults") DESC, sum("visitors") DESC`),
      this.settings(countryCode),
    ]);
    const hidden = new Set(settings.hidden);
    const mark = (r: Awaited<ReturnType<SearchInsights['rows']>>[number]) => ({ ...r, hidden: hidden.has(r.query) });
    const t = totals[0];
    return {
      days, from,
      totals: { ...t, zeroPercent: t.searches ? Math.round((t.zero / t.searches) * 1000) / 10 : 0 },
      daily,
      top: top.map(mark),
      zeroResults: zero.map(mark),
      settings,
    };
  }

  private rows(countryCode: string, from: string, tail: Prisma.Sql) {
    return this.prisma.$queryRaw<{ query: string; searches: number; visitors: number; zeroResults: number; corrected: number; lastTotal: number }[]>(sql`
      SELECT "query", sum("searches")::int AS searches, sum("visitors")::int AS visitors, sum("zeroResults")::int AS "zeroResults",
             sum("corrected")::int AS corrected, (array_agg("lastTotal" ORDER BY "day" DESC))[1] AS "lastTotal"
      FROM "SearchLog" WHERE "countryCode" = ${countryCode} AND "day" >= ${from}::date
      GROUP BY "query" ${tail} LIMIT 50`);
  }
}
