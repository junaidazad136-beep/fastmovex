import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { CountryService } from '../common/country/country.service';
import { SearchLogDto, SearchQueryDto, SearchReportQuery, SuggestQueryDto } from './dto/search.dto';
import { SearchInsights } from './search-insights.service';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiHeader({ name: 'X-Country', required: false, description: 'Market code, default QA' })
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly countries: CountryService,
    private readonly insights: SearchInsights,
  ) {}

  /** Also used for category pages (?category=slug) and store pages (?store=slug). */
  @Public() @Get()
  async find(@Query() q: SearchQueryDto, @Headers('x-country') country?: string) {
    return this.search.search(q, await this.countries.resolve(country));
  }

  /** Autocomplete while typing. Client should debounce ~200ms. */
  @Public() @Throttle({ default: { limit: 300, ttl: 60_000 } }) @Get('suggest')
  async suggest(@Query() q: SuggestQueryDto, @Headers('x-country') country?: string) {
    return this.search.suggest(q.q, await this.countries.resolve(country));
  }

  /** Searches many customers use (for the empty search box and "no results" pages). */
  @Public() @Get('popular')
  async popular(@Headers('x-country') country?: string) {
    return this.search.popular(await this.countries.resolve(country));
  }

  /**
   * The website reports each search page a visitor really saw (browsers only, so bots do not count).
   * Counted anonymously: the IP is only used in memory to count distinct visitors per day.
   */
  @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @HttpCode(204) @Post('log')
  async log(@Body() d: SearchLogDto, @Req() req: Request, @Headers('x-country') country?: string) {
    const c = await this.countries.resolve(country);
    this.insights.record(c.code, d.q, d.total, d.corrected === true, `${req.ip ?? ''}|${String(req.headers['user-agent'] ?? '').slice(0, 200)}`);
  }
}

@ApiTags('Admin / Search') @ApiBearerAuth()
@ApiHeader({ name: 'X-Country', required: false, description: 'Market code, default QA' })
@Controller({ path: 'admin/search', version: '1' })
export class AdminSearchController {
  constructor(
    private readonly insights: SearchInsights,
    private readonly countries: CountryService,
  ) {}

  /** What customers search for, what they do not find, and the market's search settings. */
  @RequirePermissions('analytics.read') @Get('report')
  async report(@Query() q: SearchReportQuery, @Headers('x-country') country?: string) {
    return this.insights.report((await this.countries.resolve(country)).code, q.days ?? 30);
  }
}
