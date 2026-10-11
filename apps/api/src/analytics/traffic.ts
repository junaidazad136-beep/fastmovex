import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Injectable, Logger, Module, OnModuleDestroy, Post, Query, Req } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { plainToInstance, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, validate, ValidateNested, ValidationError } from 'class-validator';
import type { Request } from 'express';
import { CacheService } from '../cache/cache.service';
import { CountryInfo, CountryModule, CountryService } from '../common/country/country.service';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RANGE_PRESETS, RangePreset, resolveRange, tzFor } from './range';

const { sql, join } = Prisma;

// ====================================================================== pure rules (unit-tested)

/** What the browser saw when the visit started. Only these fields — never the full address or anything typed. */
export interface Touch { utmSource?: string; utmMedium?: string; utmCampaign?: string; referrerHost?: string; click?: 'gclid' | 'fbclid' | 'ttclid' | 'msclkid' }
export interface Attribution { source: string; medium: string; campaign: string | null }

/** Lower case, letters/digits/._- only, short. */
export function token(v: string | undefined | null, max = 60): string | null {
  const t = (v ?? '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return t || null;
}

const SEARCH = [/(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /(^|\.)yahoo\.[a-z.]+$/, /(^|\.)duckduckgo\.com$/, /(^|\.)yandex\.[a-z.]+$/, /(^|\.)baidu\.com$/, /(^|\.)ecosia\.org$/];
const SOCIAL: [RegExp, string][] = [
  [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'], [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'x'],
  [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)snapchat\.com$/, 'snapchat'], [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'], [/(^|\.)pinterest\.[a-z.]+$/, 'pinterest'], [/(^|\.)reddit\.com$/, 'reddit'],
];
const MESSAGING: [RegExp, string][] = [[/(^|\.)whatsapp\.com$|^wa\.me$/, 'whatsapp'], [/^t\.me$|(^|\.)telegram\.org$/, 'telegram']];
const EMAIL = [/^mail\.google\.com$/, /^outlook\.(live|office)\.com$/, /^mail\.yahoo\.com$/];

/**
 * Where a visit came from, GA-style: campaign tags first, then ad click ids, then the referring site's kind.
 * No referrer and no tags = direct. Exported for tests.
 */
export function classify(t: Touch | undefined): Attribution {
  const campaign = token(t?.utmCampaign, 100);
  const host = (t?.referrerHost ?? '').toLowerCase().replace(/^www\./, '').replace(/^m\./, '').slice(0, 100);
  const tagged = token(t?.utmSource);
  if (tagged) return { source: tagged, medium: token(t?.utmMedium, 30) ?? (t?.click ? 'cpc' : 'campaign'), campaign };
  if (t?.click === 'gclid') return { source: 'google', medium: 'cpc', campaign };
  if (t?.click === 'msclkid') return { source: 'bing', medium: 'cpc', campaign };
  if (t?.click === 'ttclid') return { source: 'tiktok', medium: 'cpc', campaign };
  if (!host) return t?.click === 'fbclid' ? { source: 'facebook', medium: 'social', campaign } : { source: 'direct', medium: 'none', campaign: null };
  if (EMAIL.some((r) => r.test(host))) return { source: 'email', medium: 'email', campaign }; // before search: mail.google.com
  if (SEARCH.some((r) => r.test(host))) return { source: host.split('.').find((p) => ['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'baidu', 'ecosia'].includes(p)) ?? host, medium: 'organic', campaign };
  for (const [r, name] of SOCIAL) if (r.test(host)) return { source: name, medium: 'social', campaign };
  for (const [r, name] of MESSAGING) if (r.test(host)) return { source: name, medium: 'messaging', campaign };
  return { source: token(host) ?? 'referral', medium: 'referral', campaign };
}

/** Coarse device type from the browser's user agent; null for bots (they are not counted). */
export function device(ua: string | undefined): 'mobile' | 'tablet' | 'desktop' | null {
  const u = ua ?? '';
  if (!u || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp\//i.test(u)) return null;
  if (/ipad|tablet|kindle|silk/i.test(u) || (/android/i.test(u) && !/mobile/i.test(u))) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(u)) return 'mobile';
  return 'desktop';
}

/**
 * Landing page, without anything personal: no query string, and account/order/tracking pages cut to their section
 * ("/en/account/orders/FMX-QA-1" → "/en/account"). Exported for tests.
 */
export function landingKey(path: string | undefined): string | null {
  if (!path || !path.startsWith('/')) return null;
  const segs = path.split(/[?#]/)[0].split('/').filter(Boolean).slice(0, 4).map((s) => s.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 80));
  const private_ = ['account', 'checkout', 'track', 'login', 'register', 'forgot-password', 'cart', 'pay'];
  const cut = segs.findIndex((s) => private_.includes(s));
  const kept = cut >= 0 ? segs.slice(0, cut + 1) : segs.slice(0, 3);
  return `/${kept.filter(Boolean).join('/')}`.slice(0, 200);
}

// ====================================================================== ingestion

const EVENT_TYPES = ['page_view', 'product_view', 'add_to_cart', 'checkout_start'] as const;
type EventType = (typeof EVENT_TYPES)[number];

class TouchDto implements Touch {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) utmSource?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) utmMedium?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) utmCampaign?: string;
  @ApiPropertyOptional({ example: 'www.google.com' }) @IsOptional() @IsString() @MaxLength(150) referrerHost?: string;
  @ApiPropertyOptional({ enum: ['gclid', 'fbclid', 'ttclid', 'msclkid'] }) @IsOptional() @IsIn(['gclid', 'fbclid', 'ttclid', 'msclkid']) click?: Touch['click'];
}
class EventDto {
  @ApiProperty({ enum: EVENT_TYPES }) @IsIn(EVENT_TYPES) type: EventType;
  @ApiPropertyOptional({ example: '/en/p/premium-khalas-dates-1kg' }) @IsOptional() @IsString() @MaxLength(300) path?: string;
}
export class EventsDto {
  @ApiProperty({ description: 'Random id the browser makes for this visit (crypto.randomUUID), kept for the tab session only' }) @IsUUID(4) sessionId: string;
  @ApiPropertyOptional({ enum: ['en', 'ar'] }) @IsOptional() @IsIn(['en', 'ar']) locale?: 'en' | 'ar';
  @ApiPropertyOptional({ type: TouchDto, description: 'Where the visit came from (used when the session is new)' }) @IsOptional() @ValidateNested() @Type(() => TouchDto) touch?: TouchDto;
  @ApiProperty({ type: [EventDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => EventDto) events: EventDto[];
}
/** Sent with checkout so the order knows its source. */
export class OrderTrafficDto extends TouchDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID(4) sessionId?: string;
}

/** The body may come as JSON or as text (beacons); it is checked exactly like any other request body. */
export async function parseEvents(raw: unknown): Promise<EventsDto> {
  let body = raw;
  if (typeof raw === 'string') {
    try { body = JSON.parse(raw); } catch { throw new BadRequestException('Body must be JSON'); }
  }
  if (!body || typeof body !== 'object') throw new BadRequestException('Body must be a JSON object');
  const dto = plainToInstance(EventsDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException(errors.flatMap((e) => flattenErrors(e)));
  return dto;
}
const flattenErrors = (e: ValidationError, path = ''): string[] => [
  ...Object.values(e.constraints ?? {}).map((m) => (path ? `${path}.${m}` : m)),
  ...(e.children ?? []).flatMap((c) => flattenErrors(c, path ? `${path}.${e.property}` : e.property)),
];

interface Pending {
  id: string; countryCode: string; startedAt: Date; lastSeenAt: Date; attribution: Attribution; landingPath: string | null; device: string; locale: string | null;
  pageViews: number; productViews: number; addedToCart: boolean; startedCheckout: boolean; purchased: boolean;
}

const SOLD = sql`o."status" NOT IN ('PENDING', 'CANCELLED')`;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * Anonymous first-party analytics: sessions counted in memory and written in batches (never slows a page down),
 * the order's source, and the staff reports (funnel, sources, devices, landing pages).
 */
@Injectable()
export class TrafficService implements OnModuleDestroy {
  private readonly logger = new Logger(TrafficService.name);
  private buffer = new Map<string, Pending>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  record(countryCode: string, dto: EventsDto, ua: string | undefined, now = new Date()): boolean {
    const dev = device(ua);
    if (!dev) return false;
    const b = this.buffer.get(dto.sessionId) ?? {
      id: dto.sessionId, countryCode, startedAt: now, lastSeenAt: now, attribution: classify(dto.touch), landingPath: null, device: dev, locale: dto.locale ?? null,
      pageViews: 0, productViews: 0, addedToCart: false, startedCheckout: false, purchased: false,
    };
    for (const e of dto.events) {
      if (e.type === 'page_view') { b.pageViews++; b.landingPath ??= landingKey(e.path); }
      if (e.type === 'product_view') b.productViews++;
      if (e.type === 'add_to_cart') b.addedToCart = true;
      if (e.type === 'checkout_start') b.startedCheckout = true;
    }
    b.lastSeenAt = now;
    this.buffer.set(dto.sessionId, b);
    if (this.buffer.size >= 2_000) void this.flush();
    return true;
  }

  /** An order was placed in this session. */
  purchased(countryCode: string, sessionId: string | undefined, now = new Date()) {
    if (!sessionId) return;
    const b = this.buffer.get(sessionId) ?? {
      id: sessionId, countryCode, startedAt: now, lastSeenAt: now, attribution: { source: 'direct', medium: 'none', campaign: null }, landingPath: null, device: 'desktop', locale: null,
      pageViews: 0, productViews: 0, addedToCart: false, startedCheckout: false, purchased: false,
    };
    b.purchased = true;
    b.lastSeenAt = now;
    this.buffer.set(sessionId, b);
  }

  @Interval(15_000)
  async flush(): Promise<number> {
    if (!this.buffer.size) return 0;
    const rows = [...this.buffer.values()];
    this.buffer = new Map();
    try {
      for (let i = 0; i < rows.length; i += 500) {
        const values = rows.slice(i, i + 500).map((r) => {
          const day = new Date(r.startedAt.getTime() + tzFor(r.countryCode).offsetMin * 60_000).toISOString().slice(0, 10);
          return sql`(${r.id}::uuid, ${r.countryCode}, ${day}::date, ${r.startedAt}, ${r.lastSeenAt}, ${r.attribution.source}, ${r.attribution.medium}, ${r.attribution.campaign},
            ${r.landingPath}, ${r.device}, ${r.locale}, ${r.pageViews}, ${r.productViews}, ${r.addedToCart}, ${r.startedCheckout}, ${r.purchased})`;
        });
        // the first batch of a session decides its source, landing page and device; later batches only add counts
        await this.prisma.$executeRaw(sql`
          INSERT INTO "AnalyticsSession" ("id", "countryCode", "day", "startedAt", "lastSeenAt", "source", "medium", "campaign",
            "landingPath", "device", "locale", "pageViews", "productViews", "addedToCart", "startedCheckout", "purchased")
          VALUES ${join(values)}
          ON CONFLICT ("id") DO UPDATE SET
            "lastSeenAt" = GREATEST("AnalyticsSession"."lastSeenAt", EXCLUDED."lastSeenAt"),
            "landingPath" = COALESCE("AnalyticsSession"."landingPath", EXCLUDED."landingPath"),
            "pageViews" = "AnalyticsSession"."pageViews" + EXCLUDED."pageViews",
            "productViews" = "AnalyticsSession"."productViews" + EXCLUDED."productViews",
            "addedToCart" = "AnalyticsSession"."addedToCart" OR EXCLUDED."addedToCart",
            "startedCheckout" = "AnalyticsSession"."startedCheckout" OR EXCLUDED."startedCheckout",
            "purchased" = "AnalyticsSession"."purchased" OR EXCLUDED."purchased"`);
      }
    } catch (e) {
      this.logger.warn(`analytics not saved: ${(e as Error).message}`);
    }
    return rows.length;
  }

  async onModuleDestroy() { await this.flush(); }

  /** Sessions are kept 13 months (year-on-year comparisons), then deleted. */
  @Interval(6 * 3_600_000)
  async prune(now = new Date()) {
    if (process.env.NODE_ENV === 'test') return 0;
    const before = new Date(now.getTime() - 400 * 86_400_000);
    return this.prisma.analyticsSession.deleteMany({ where: { startedAt: { lt: before } } }).then((r) => r.count).catch(() => 0);
  }

  // ---------------------------------------------------------------- report

  async report(country: CountryInfo, preset: RangePreset, custom: { from?: string; to?: string }, now = new Date()) {
    const { from, to } = resolveRange(preset, now, country.code, custom);
    await this.flush();
    return this.cache.wrap(`traffic:${country.code}:${preset}:${custom.from ?? ''}:${custom.to ?? ''}`, preset === 'today' ? 15 : 300, async () => {
      const where = sql`s."countryCode" = ${country.code} AND s."startedAt" >= ${from} AND s."startedAt" < ${to}`;
      const orderWhere = sql`o."countryCode" = ${country.code} AND o."placedAt" >= ${from} AND o."placedAt" < ${to} AND ${SOLD}`;
      const offset = tzFor(country.code).offsetMin;
      const [[f], sources, orders, devices, landing, daily, dailyOrders] = await Promise.all([
        this.prisma.$queryRaw<[{ visits: number; product: number; cart: number; checkout: number; purchase: number; pages: number }]>(sql`
          SELECT count(*)::int AS visits, count(*) FILTER (WHERE s."productViews" > 0)::int AS product,
                 count(*) FILTER (WHERE s."addedToCart")::int AS cart, count(*) FILTER (WHERE s."startedCheckout")::int AS checkout,
                 count(*) FILTER (WHERE s."purchased")::int AS purchase, coalesce(sum(s."pageViews"), 0)::int AS pages
          FROM "AnalyticsSession" s WHERE ${where}`),
        this.prisma.$queryRaw<{ source: string; medium: string; sessions: number; carts: number; purchases: number }[]>(sql`
          SELECT s."source", s."medium", count(*)::int AS sessions, count(*) FILTER (WHERE s."addedToCart")::int AS carts, count(*) FILTER (WHERE s."purchased")::int AS purchases
          FROM "AnalyticsSession" s WHERE ${where} GROUP BY 1, 2 ORDER BY sessions DESC LIMIT 30`),
        this.prisma.$queryRaw<{ source: string | null; medium: string | null; orders: number; revenue: bigint | null }[]>(sql`
          SELECT o."trafficSource" AS source, o."trafficMedium" AS medium, count(*)::int AS orders, sum(o."totalMinor")::bigint AS revenue
          FROM "Order" o WHERE ${orderWhere} GROUP BY 1, 2`),
        this.prisma.$queryRaw<{ device: string; sessions: number; purchases: number }[]>(sql`
          SELECT s."device", count(*)::int AS sessions, count(*) FILTER (WHERE s."purchased")::int AS purchases
          FROM "AnalyticsSession" s WHERE ${where} GROUP BY 1 ORDER BY sessions DESC`),
        this.prisma.$queryRaw<{ path: string; sessions: number; purchases: number }[]>(sql`
          SELECT coalesce(s."landingPath", '/') AS path, count(*)::int AS sessions, count(*) FILTER (WHERE s."purchased")::int AS purchases
          FROM "AnalyticsSession" s WHERE ${where} GROUP BY 1 ORDER BY sessions DESC LIMIT 10`),
        this.prisma.$queryRaw<{ day: string; sessions: number }[]>(sql`
          SELECT to_char(s."day", 'YYYY-MM-DD') AS day, count(*)::int AS sessions FROM "AnalyticsSession" s WHERE ${where} GROUP BY 1 ORDER BY 1`),
        this.prisma.$queryRaw<{ day: string; orders: number }[]>(sql`
          SELECT to_char(o."placedAt" + make_interval(mins => ${offset}), 'YYYY-MM-DD') AS day, count(*)::int AS orders FROM "Order" o WHERE ${orderWhere} GROUP BY 1 ORDER BY 1`),
      ]);

      // sources: visits from sessions, sales from orders (an order may come from the app or before tracking: "unknown")
      const key = (s: string | null, m: string | null) => `${s ?? 'unknown'}|${m ?? 'unknown'}`;
      const bySource = new Map<string, { source: string; medium: string; sessions: number; carts: number; purchases: number; orders: number; revenueMinor: bigint }>();
      for (const r of sources) bySource.set(key(r.source, r.medium), { ...r, orders: 0, revenueMinor: 0n });
      for (const o of orders) {
        const k = key(o.source, o.medium);
        const row = bySource.get(k) ?? { source: o.source ?? 'unknown', medium: o.medium ?? 'unknown', sessions: 0, carts: 0, purchases: 0, orders: 0, revenueMinor: 0n };
        row.orders += o.orders;
        row.revenueMinor += o.revenue ?? 0n;
        bySource.set(k, row);
      }
      const totalOrders = orders.reduce((n, o) => n + o.orders, 0);
      const steps = [
        { step: 'visit', sessions: f.visits }, { step: 'product', sessions: f.product }, { step: 'cart', sessions: f.cart },
        { step: 'checkout', sessions: f.checkout }, { step: 'purchase', sessions: f.purchase },
      ];
      const ordersByDay = new Map(dailyOrders.map((d) => [d.day, d.orders]));
      const days = new Set([...daily.map((d) => d.day), ...ordersByDay.keys()]);
      return {
        currencyCode: country.currencyCode, from, to,
        totals: { sessions: f.visits, pageViews: f.pages, orders: totalOrders, conversionPercent: pct(f.purchase, f.visits), pagesPerSession: f.visits ? Math.round((f.pages / f.visits) * 10) / 10 : 0 },
        funnel: steps.map((s, i) => ({ ...s, percentOfVisits: pct(s.sessions, f.visits), dropOffPercent: i === 0 ? 0 : Math.round((100 - pct(s.sessions, steps[i - 1].sessions)) * 10) / 10 })),
        sources: [...bySource.values()]
          .sort((a, b) => b.sessions - a.sessions || Number(b.revenueMinor - a.revenueMinor))
          .map((r) => ({ ...r, revenueMinor: r.revenueMinor.toString(), conversionPercent: pct(r.purchases, r.sessions) })),
        devices: devices.map((d) => ({ ...d, conversionPercent: pct(d.purchases, d.sessions) })),
        landingPages: landing.map((l) => ({ ...l, conversionPercent: pct(l.purchases, l.sessions) })),
        daily: [...days].sort().map((day) => ({ day, sessions: daily.find((d) => d.day === day)?.sessions ?? 0, orders: ordersByDay.get(day) ?? 0 })),
      };
    });
  }
}

class TrafficQuery {
  @ApiPropertyOptional({ enum: RANGE_PRESETS, default: '30d' }) @IsOptional() @IsIn(RANGE_PRESETS) range?: RangePreset;
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ example: '2026-09-30' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

@ApiTags('Analytics')
@ApiHeader({ name: 'X-Country', required: false })
@Controller({ path: 'analytics', version: '1' })
export class TrafficController {
  constructor(private readonly traffic: TrafficService, private readonly countries: CountryService) {}

  /** Website/app events, batched by the client. Anonymous: a random visit id, the page path, no personal data. */
  @Public() @Throttle({ default: { limit: 120, ttl: 60_000 } }) @HttpCode(204) @Post('events')
  @ApiBody({ type: EventsDto, description: 'JSON, sent as application/json or text/plain (beacon)' })
  async events(@Body() raw: unknown, @Req() req: Request, @Headers('x-country') header?: string, @Query('country') query?: string) {
    const d = await parseEvents(raw);
    const c = await this.countries.resolve(header ?? query);
    this.traffic.record(c.code, d, req.headers['user-agent']);
  }
}

@ApiTags('Admin / Analytics') @ApiBearerAuth() @RequirePermissions('analytics.read')
@ApiHeader({ name: 'X-Country', required: false })
@Controller({ path: 'admin/analytics', version: '1' })
export class AdminTrafficController {
  constructor(private readonly traffic: TrafficService, private readonly countries: CountryService) {}

  /** Visits, the shopping funnel (product → cart → checkout → order), and sales by source, device and landing page. */
  @Get('traffic') async report(@Query() q: TrafficQuery, @Headers('x-country') country?: string) {
    return this.traffic.report(await this.countries.resolve(country), q.range ?? '30d', { from: q.from, to: q.to });
  }
}

@Module({ imports: [CountryModule], controllers: [TrafficController, AdminTrafficController], providers: [TrafficService], exports: [TrafficService] })
export class TrafficModule {}
