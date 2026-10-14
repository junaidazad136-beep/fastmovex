import { Controller, Get, Injectable, Logger, Optional, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { StorefrontService } from '../common/storefront.service';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AutoText, fromXml, hashText, Job, Lang, optionTerms, planPairs, splitLines, toXml, worthTranslating } from './text';
import { DeepLTranslator, FakeTranslator, KeyRejectedError, QuotaExceededError, Translator } from './translator';

export const PRODUCT_PAIRS: [string, string][] = [['title', 'titleAr'], ['shortDescription', 'shortDescriptionAr'], ['description', 'descriptionAr']];
export const STORE_PAIRS: [string, string][] = [['description', 'descriptionAr']];
/** A row edited this long after its last translation is looked at again by the background sweep. */
const SETTLE = "interval '5 seconds'";
const BATCH = 25;

type State = 'ok' | 'quota' | 'key' | 'error';

/**
 * Sellers write in one language; the shop shows both. Product title, short line, description and option words, and the
 * store's "about" text, are translated English ⇄ Arabic by the machine. What the machine wrote is remembered per field
 * (Product.autoText / Store.autoText), so a seller's own Arabic is never overwritten and a changed English is
 * translated again. A product is translated right after a seller or staff edit; everything else (CSV imports,
 * older products, store pages) is picked up by a sweep every minute.
 */
@Injectable()
export class TranslationService {
  private readonly log = new Logger('Translation');
  readonly translator: Translator | null;
  private readonly sweepOn: boolean;
  private pausedUntil = 0;
  private state: State = 'ok';
  private lastError: string | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {
    const provider = config.get('TRANSLATE_PROVIDER', { infer: true });
    const key = config.get('DEEPL_API_KEY', { infer: true });
    this.translator = provider === 'fake' ? new FakeTranslator()
      : provider === 'deepl' && key ? new DeepLTranslator(key, config.get('DEEPL_API_URL', { infer: true }) || undefined)
        : null;
    this.sweepOn = config.get('TRANSLATE_SWEEP', { infer: true }) !== 'off';
  }

  get enabled() { return !!this.translator; }
  private get paused() { return Date.now() < this.pausedUntil; }

  // ------------------------------------------------------------------ products and stores

  /** Fills in the missing language of one product. Throws on translator errors (see `now` for the safe version). */
  async translateProduct(id: string): Promise<boolean> {
    const t = this.translator;
    if (!t) return false;
    const p = await this.prisma.product.findUnique({
      where: { id },
      select: {
        slug: true, title: true, titleAr: true, shortDescription: true, shortDescriptionAr: true, description: true, descriptionAr: true,
        autoText: true, optionsAr: true, brand: { select: { name: true } }, variants: { select: { optionValues: true } },
      },
    });
    if (!p) return false;
    const keep = p.brand?.name ? [p.brand.name] : [];
    const plan = planPairs(p, PRODUCT_PAIRS, (p.autoText ?? {}) as AutoText);
    const texts = await this.run(plan.jobs, keep);
    plan.jobs.forEach((j, i) => { plan.set[j.field] = texts[i]; plan.auto[j.field] = { text: texts[i], src: hashText(j.source) }; });

    // option words ("Colour", "Black"): a small dictionary per product, kept for words still in use
    const dict = (p.optionsAr ?? {}) as Record<string, string>;
    const terms = optionTerms(p.variants);
    const missing = terms.filter((w) => !dict[w]);
    const words = missing.length ? (await t.translate(missing.map((w) => toXml(w, 'en', keep)), 'en', 'ar')).map(fromXml) : [];
    const nextDict: Record<string, string> = Object.fromEntries(terms.map((w) => [w, dict[w] ?? words[missing.indexOf(w)]]));
    const dictChanged = JSON.stringify(nextDict) !== JSON.stringify(dict) && !(terms.length === 0 && p.optionsAr === null);

    const autoChanged = JSON.stringify(plan.auto) !== JSON.stringify(p.autoText ?? {});
    if (!Object.keys(plan.set).length && !autoChanged && !dictChanged) {
      await this.prisma.$executeRaw`UPDATE "Product" SET "translatedAt" = now() WHERE id = ${id}::uuid`;
      return false;
    }
    await this.prisma.product.update({
      where: { id },
      data: {
        ...plan.set,
        autoText: plan.auto as Prisma.InputJsonValue,
        optionsAr: terms.length ? nextDict : Prisma.DbNull,
        translatedAt: new Date(),
      } as Prisma.ProductUpdateInput,
    });
    await this.cache?.del(`product:v1:${p.slug}`);
    this.storefront?.refresh(`product:${p.slug}`, 'search');
    return true;
  }

  async translateStore(id: string): Promise<boolean> {
    if (!this.translator) return false;
    const s = await this.prisma.store.findUnique({ where: { id }, select: { slug: true, name: true, description: true, descriptionAr: true, autoText: true } });
    if (!s) return false;
    const plan = planPairs(s, STORE_PAIRS, (s.autoText ?? {}) as AutoText);
    const texts = await this.run(plan.jobs, [s.name]);
    plan.jobs.forEach((j, i) => { plan.set[j.field] = texts[i]; plan.auto[j.field] = { text: texts[i], src: hashText(j.source) }; });
    if (!Object.keys(plan.set).length && JSON.stringify(plan.auto) === JSON.stringify(s.autoText ?? {})) {
      await this.prisma.$executeRaw`UPDATE "Store" SET "translatedAt" = now() WHERE id = ${id}::uuid`;
      return false;
    }
    await this.prisma.store.update({ where: { id }, data: { ...plan.set, autoText: plan.auto as Prisma.InputJsonValue, translatedAt: new Date() } });
    this.storefront?.refresh(`store:${s.slug}`);
    return true;
  }

  /** Right after an edit: translate now, but never let a translator problem fail or slow the save beyond a few seconds. */
  async now(productId: string): Promise<void> {
    if (!this.translator || this.paused) return;
    await this.safely(() => this.translateProduct(productId));
  }

  // ------------------------------------------------------------------ the sweep

  @Interval(60_000)
  async sweep(): Promise<{ products: number; stores: number }> {
    const done = { products: 0, stores: 0 };
    if (!this.translator || !this.sweepOn || this.running || this.paused) return done;
    this.running = true;
    try {
      const products = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "Product" WHERE "deletedAt" IS NULL AND ("translatedAt" IS NULL OR "updatedAt" > "translatedAt" + ${SETTLE}) ORDER BY "updatedAt" DESC LIMIT ${BATCH}`);
      for (const { id } of products) {
        if (!(await this.safely(() => this.translateProduct(id)))) return done;
        done.products++;
      }
      const stores = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "Store" WHERE "translatedAt" IS NULL OR "updatedAt" > "translatedAt" + ${SETTLE} ORDER BY "updatedAt" DESC LIMIT ${BATCH}`);
      for (const { id } of stores) {
        if (!(await this.safely(() => this.translateStore(id)))) return done;
        done.stores++;
      }
      return done;
    } finally {
      this.running = false;
    }
  }

  /** Runs one translation; on trouble pauses the machine (quota: hours, bad key: an hour, other: two minutes). */
  private async safely(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      if (this.state !== 'ok') { this.state = 'ok'; this.lastError = null; }
      return true;
    } catch (e) {
      const [state, wait] = e instanceof QuotaExceededError ? ['quota', 6 * 3_600_000] as const
        : e instanceof KeyRejectedError ? ['key', 3_600_000] as const
          : ['error', 120_000] as const;
      this.state = state;
      this.lastError = (e as Error).message;
      this.pausedUntil = Date.now() + wait;
      this.log.warn(`translation paused for ${Math.round(wait / 60_000)} min: ${this.lastError}`);
      return false;
    }
  }

  /** Translates whole fields, line by line, keeping bullets, headings and blank lines exactly where they were. */
  private async run(jobs: Job[], keep: string[]): Promise<string[]> {
    const out: string[] = new Array(jobs.length);
    for (const from of ['en', 'ar'] as Lang[]) {
      const mine = jobs.map((j, i) => ({ j, i })).filter(({ j }) => j.from === from);
      if (!mine.length) continue;
      const pieces: string[] = [];
      const layout = mine.map(({ j, i }) => ({
        i,
        lines: splitLines(j.source).map((l) => {
          if (!worthTranslating(l.body)) return { ...l, at: -1 };
          pieces.push(toXml(l.body, from, keep));
          return { ...l, at: pieces.length - 1 };
        }),
      }));
      const res = pieces.length ? await this.translator!.translate(pieces, from, from === 'en' ? 'ar' : 'en') : [];
      for (const { i, lines } of layout) out[i] = lines.map((l) => l.prefix + (l.at < 0 ? l.body : fromXml(res[l.at]))).join('\n').trim();
    }
    return out;
  }

  // ------------------------------------------------------------------ staff view

  async status() {
    const [waiting, auto, noArabic] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Product" WHERE "deletedAt" IS NULL AND ("translatedAt" IS NULL OR "updatedAt" > "translatedAt" + ${SETTLE})`),
      this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Product" WHERE "deletedAt" IS NULL AND "autoText" <> '{}'::jsonb`),
      this.prisma.product.count({ where: { deletedAt: null, OR: [{ titleAr: null }, { titleAr: '' }] } }),
    ]);
    let usage: { used: number; limit: number } | null = null;
    if (this.translator) usage = await this.translator.usage().catch(() => null);
    return {
      provider: this.translator?.name ?? 'off',
      state: this.translator ? this.state : 'off',
      lastError: this.lastError,
      pausedUntil: this.paused ? new Date(this.pausedUntil).toISOString() : null,
      usage,
      waiting: Number(waiting[0]?.n ?? 0),
      autoTranslated: Number(auto[0]?.n ?? 0),
      withoutArabic: noArabic,
    };
  }

  /** Staff "translate now": clears a pause and runs one sweep at once. */
  async runNow() {
    this.pausedUntil = 0;
    const done = await this.sweep();
    return { ...done, ...(await this.status()) };
  }
}

@ApiTags('Admin / Translation')
@ApiBearerAuth()
@Controller({ path: 'admin/translation', version: '1' })
export class AdminTranslationController {
  constructor(private readonly translation: TranslationService) {}

  @RequirePermissions('products.read') @Get()
  status() { return this.translation.status(); }

  @RequirePermissions('products.manage') @Post('run')
  run() { return this.translation.runNow(); }
}
