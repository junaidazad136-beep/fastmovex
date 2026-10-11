import { Controller, Get, Headers, Module, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CountryService } from '../common/country/country.service';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { formatMoney } from '../notifications/templates';
import { AnalyticsService, TopKind } from './analytics.service';
import { ExportFormat, ExportService, Table } from './export.service';
import { RANGE_PRESETS, RangePreset } from './range';

class RangeQuery {
  @ApiPropertyOptional({ enum: RANGE_PRESETS, default: '30d' }) @IsOptional() @IsIn(RANGE_PRESETS) range?: RangePreset;
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ example: '2026-09-30' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
const KINDS = ['products', 'sellers', 'categories', 'customers'] as const;
class TopQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: KINDS, default: 'products' }) @IsOptional() @IsIn(KINDS) kind?: TopKind;
  @ApiPropertyOptional({ default: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
const REPORTS = ['summary', 'orders', 'products', 'sellers', 'categories', 'customers'] as const;
class ExportQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: REPORTS }) @IsIn(REPORTS) report: (typeof REPORTS)[number];
  @ApiPropertyOptional({ enum: ['csv', 'xlsx', 'pdf'] }) @IsIn(['csv', 'xlsx', 'pdf']) format: ExportFormat;
}

const range = (q: RangeQuery) => ({ range: q.range ?? '30d', from: q.from, to: q.to });
const money = (m: string, cur: string) => formatMoney(m, cur);

@ApiTags('Admin / Analytics') @ApiBearerAuth() @RequirePermissions('analytics.read')
@Controller({ path: 'admin/analytics', version: '1' })
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly exporter: ExportService,
    private readonly countries: CountryService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview') async overview(@Query() q: RangeQuery, @Headers('x-country') c?: string) { return this.analytics.overview(await this.countries.resolve(c), range(q)); }
  @Get('timeseries') async ts(@Query() q: RangeQuery, @Headers('x-country') c?: string) { return this.analytics.timeseries(await this.countries.resolve(c), range(q)); }
  @Get('top') async top(@Query() q: TopQuery, @Headers('x-country') c?: string) { return this.analytics.top(await this.countries.resolve(c), range(q), q.kind ?? 'products', q.limit ?? 10); }

  /** Every export is audited (it is the easiest way to take data out of the company). */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('export')
  async export(@Query() q: ExportQuery, @CurrentUser() u: AuthUser, @Res() res: Response, @Headers('x-country') c?: string) {
    const country = await this.countries.resolve(c);
    const r = range(q);
    let table: Table;
    if (q.report === 'summary') {
      const o = await this.analytics.platformOverview(country, r);
      const cur = country.currencyCode;
      table = {
        title: `Summary ${r.range}`, columns: ['Metric', 'Value'],
        rows: [
          ['Orders', o.orders], ['GMV', money(o.gmvMinor, cur)], ['Average order value', money(o.averageOrderValueMinor, cur)],
          ['Commission revenue', money(o.commissionRevenueMinor, cur)], ['Refunds', money(o.refunds.amountMinor, cur)],
          ['Refund rate %', (o.refunds.rateBps / 100).toFixed(2)], ['New customers', o.newCustomers], ['Cart to order %', (o.cartToOrderRateBps / 100).toFixed(2)],
        ],
      };
    } else if (q.report === 'orders') {
      const rows = await this.analytics.orderRows(country, r);
      table = {
        title: `Orders ${r.range}`,
        columns: ['Order', 'Placed (UTC)', 'Status', 'Customer', 'Items', 'Subtotal', 'Discount', 'Delivery', 'Tax', 'Total', 'Currency', 'Payment'],
        rows: rows.map((o) => [o.orderNumber, o.placedAt.toISOString(), o.status, o.user.fullName, o._count.items,
          o.subtotalMinor.toString(), o.discountMinor.toString(), o.deliveryFeeMinor.toString(), o.taxMinor.toString(), o.totalMinor.toString(),
          o.currencyCode, o.payments[0] ? `${o.payments[0].method} ${o.payments[0].status}` : '']),
      };
    } else {
      const top = await this.analytics.top(country, r, q.report, 100);
      table = { title: `Top ${q.report} ${r.range}`, columns: ['Name', 'Orders', 'Units', `GMV (${country.currencyCode} minor units)`], rows: top.items.map((i) => [i.name, i.orders, i.units, i.gmvMinor]) };
    }
    const file = await this.exporter.render(table, q.format);
    await this.audit.log({ actorId: u.id, action: 'analytics.export', entityType: 'Report', entityId: q.report, after: { format: q.format, range: r.range, rows: table.rows.length } });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="fastmovex-${q.report}-${r.range}.${file.ext}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  }
}

@ApiTags('Seller / Analytics') @ApiBearerAuth() @UseGuards(SellerGuard)
@Controller({ path: 'seller/analytics', version: '1' })
export class SellerAnalyticsController {
  constructor(private readonly analytics: AnalyticsService, private readonly countries: CountryService) {}
  @Get('overview') async overview(@CurrentSeller() s: SellerContext, @Query() q: RangeQuery) { return this.analytics.overview(await this.countries.resolve(s.countryCode), range(q), s.id); }
  @Get('timeseries') async ts(@CurrentSeller() s: SellerContext, @Query() q: RangeQuery) { return this.analytics.timeseries(await this.countries.resolve(s.countryCode), range(q), s.id); }
  @Get('top-products') async top(@CurrentSeller() s: SellerContext, @Query() q: TopQuery) { return this.analytics.top(await this.countries.resolve(s.countryCode), range(q), 'products', q.limit ?? 10, s.id); }
}

@Module({ controllers: [AdminAnalyticsController, SellerAnalyticsController], providers: [AnalyticsService, ExportService] })
export class AnalyticsModule {}
