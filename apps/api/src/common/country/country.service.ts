import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../cache/cache.service';
import { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

export interface CountryInfo {
  code: string;
  currencyCode: string;
  minorUnits: number;
  vatRateBps: number;
  pricesIncludeTax: boolean;
  defaultLocale: string;
  deliveryConfig: unknown;
}

/**
 * Resolves which market a request belongs to from the "X-Country" header (QA, AE, ...).
 * Falls back to DEFAULT_COUNTRY. Only active countries are accepted — nothing is hard-coded to Qatar.
 */
@Injectable()
export class CountryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async active(): Promise<CountryInfo[]> {
    return this.cache.wrap('countries:active', 300, async () => {
      const rows = await this.prisma.country.findMany({
        where: { isActive: true },
        select: { code: true, currencyCode: true, vatRateBps: true, pricesIncludeTax: true, defaultLocale: true, deliveryConfig: true, currency: { select: { minorUnits: true } } },
      });
      return rows.map(({ currency, ...c }) => ({ ...c, minorUnits: currency.minorUnits }));
    });
  }

  async resolve(header: string | string[] | undefined): Promise<CountryInfo> {
    const requested = (Array.isArray(header) ? header[0] : header)?.trim().toUpperCase();
    const code = requested || this.config.get('DEFAULT_COUNTRY', { infer: true }) || 'QA';
    const found = (await this.active()).find((c) => c.code === code);
    if (!found) throw new BadRequestException(`FastMoveX is not available in ${code} yet`);
    return found;
  }
}

@Global()
@Module({ providers: [CountryService], exports: [CountryService] })
export class CountryModule {}
