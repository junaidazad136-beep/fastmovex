import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Optional, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { PaymentMethod, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { PaymentsModule } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { MINOR_AMOUNT_REGEX } from '../common/utils/money';
import { StorefrontService } from '../common/storefront.service';
import { parseSlotConfig } from '../delivery/slots';
import { parseReminderConfig } from '../marketing/cart-reminders';
import { parseSearchSettings } from '../search/search-text';
import { parseCodRules, readCodRules } from '../cash/cod-rules';
import { parseSeoSettings } from '../seo/seo-rules';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class DeliveryConfigDto {
  @ApiPropertyOptional({ example: '1000', description: 'Fee per seller shipment, minor units' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) flatFeeMinor?: string;
  @ApiPropertyOptional({ example: '10000', nullable: true, description: 'Goods (after discount) at or above this ship free; null = never free' })
  @IsOptional() @Matches(MINOR_AMOUNT_REGEX) freeOverMinor?: string | null;
  @ApiPropertyOptional({ example: 'Standard delivery' }) @IsOptional() @IsString() @MaxLength(60) label?: string;
}

class UpdateCountryDto {
  @ApiPropertyOptional({ example: 0, description: 'VAT in basis points: 500 = 5%' }) @IsOptional() @IsInt() @Min(0) @Max(5000) vatRateBps?: number;
  @ApiPropertyOptional({ description: 'true = shelf prices already include VAT' }) @IsOptional() @IsBoolean() pricesIncludeTax?: boolean;
  @ApiPropertyOptional({ enum: PaymentMethod, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEnum(PaymentMethod, { each: true }) paymentMethods?: PaymentMethod[];
  @ApiPropertyOptional({ type: DeliveryConfigDto }) @IsOptional() @ValidateNested() @Type(() => DeliveryConfigDto) deliveryConfig?: DeliveryConfigDto;
  @ApiPropertyOptional({ enum: ['en', 'ar'] }) @IsOptional() @IsIn(['en', 'ar']) defaultLocale?: string;
  @ApiPropertyOptional({ description: 'Terms/returns links, company registration, etc.' }) @IsOptional() @IsObject() legalSettings?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Open or close the market' }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Let shoppers order without creating an account' }) @IsOptional() @IsBoolean() guestCheckout?: boolean;
  @ApiPropertyOptional({ description: 'Delivery time windows: { enabled, required, daysAhead, leadMinutes, closedWeekdays, closedDates, windows: [{ start, end, capacity }] }' })
  @IsOptional() @IsObject() deliverySlots?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Abandoned-cart reminders: { enabled, firstAfterMinutes, secondAfterHours|null, quietFrom, quietTo }' })
  @IsOptional() @IsObject() cartReminders?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Search: { pinned: string[], hidden: string[], synonyms: string[][] }' })
  @IsOptional() @IsObject() searchSettings?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Cash on delivery: { phoneCheck: OFF|GUESTS|ALL, maxOrderMinor, maxOpenOrders, refusalLimit, driverCashLimitMinor } (null = no limit)' })
  @IsOptional() @IsObject() codRules?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Search engines & social: { googleVerification, bingVerification, social: { instagram, facebook, tiktok, x, youtube, snapchat, linkedin }, merchantFeed }' })
  @IsOptional() @IsObject() seoSettings?: Record<string, unknown>;
}

/** Market settings: currency is fixed per country; everything else is business configuration, never code. */
@Injectable()
export class CountriesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  async list() {
    const rows = await this.prisma.country.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }], include: { currency: true } });
    return rows.map((c) => ({ ...c, codRules: readCodRules(c.codRules), seoSettings: parseSeoSettings(c.seoSettings, false) })); // with defaults filled in, as checkout applies them
  }

  integrations() {
    const n = this.notifications;
    return {
      payments: this.payments.cardProvider(), // 'dibsy' | 'test' | null
      email: !!n?.channelEnabled('EMAIL'),
      sms: !!n?.channelEnabled('SMS'),
      whatsapp: !!n?.channelEnabled('WHATSAPP'),
      push: !!n?.channelEnabled('PUSH'),
    };
  }

  async update(code: string, dto: UpdateCountryDto, actor: AuthUser) {
    const current = await this.prisma.country.findUnique({ where: { code: code.toUpperCase() } });
    if (!current) throw new NotFoundException('Country not found');
    const paymentMethods = dto.paymentMethods ?? current.paymentMethods;
    if ((dto.isActive ?? current.isActive) && paymentMethods.length === 0) throw new BadRequestException('An active market needs at least one payment method');
    if (dto.isActive === false && code.toUpperCase() === (process.env.DEFAULT_COUNTRY ?? 'QA')) {
      throw new BadRequestException('The default market cannot be closed. Change DEFAULT_COUNTRY first.');
    }
    let deliveryConfig: Prisma.InputJsonValue | undefined;
    if (dto.deliveryConfig) {
      const merged = { ...((current.deliveryConfig as Record<string, unknown>) ?? {}), ...dto.deliveryConfig };
      deliveryConfig = merged as Prisma.InputJsonValue;
    }
    const cartReminders = dto.cartReminders ? (parseReminderConfig(dto.cartReminders) as unknown as Prisma.InputJsonValue) : undefined;
    const deliverySlots = dto.deliverySlots ? (parseSlotConfig(dto.deliverySlots) as unknown as Prisma.InputJsonValue) : undefined;
    const searchSettings = dto.searchSettings ? (parseSearchSettings(dto.searchSettings) as unknown as Prisma.InputJsonValue) : undefined;
    // partial updates keep the other rules as they are
    const codRules = dto.codRules ? (parseCodRules({ ...readCodRules(current.codRules), ...dto.codRules }) as unknown as Prisma.InputJsonValue) : undefined;
    const seoSettings = dto.seoSettings ? (parseSeoSettings({ ...parseSeoSettings(current.seoSettings, false), ...dto.seoSettings }) as unknown as Prisma.InputJsonValue) : undefined;
    const updated = await this.prisma.country.update({
      where: { code: current.code },
      data: {
        seoSettings,
        vatRateBps: dto.vatRateBps, pricesIncludeTax: dto.pricesIncludeTax, paymentMethods: dto.paymentMethods, defaultLocale: dto.defaultLocale,
        legalSettings: dto.legalSettings as Prisma.InputJsonValue | undefined, isActive: dto.isActive, guestCheckout: dto.guestCheckout, deliveryConfig, deliverySlots, cartReminders, searchSettings, codRules,
      },
      include: { currency: true },
    });
    await this.cache.del('countries:active', `home:${current.code}`, 'markets:public');
    if (seoSettings) await this.cache.del(`feed:${current.code}:1`);
    if (searchSettings) await this.cache.del(`search:settings:${current.code}`, `search:popular:${current.code}`, `search:none:${current.code}`);
    this.storefront?.refresh('markets', 'home', 'offers', ...(searchSettings ? ['search'] : []));
    await this.audit.log({
      actorId: actor.id, action: 'country.update', entityType: 'Country', entityId: current.code,
      before: { codRules: current.codRules as Prisma.InputJsonValue, deliverySlots: current.deliverySlots as Prisma.InputJsonValue, searchSettings: current.searchSettings as Prisma.InputJsonValue, vatRateBps: current.vatRateBps, pricesIncludeTax: current.pricesIncludeTax, paymentMethods: current.paymentMethods, deliveryConfig: current.deliveryConfig as Prisma.InputJsonValue, isActive: current.isActive },
      after: { ...dto } as Prisma.InputJsonValue,
    });
    return updated;
  }
}

@ApiTags('Admin / Settings') @ApiBearerAuth() @RequirePermissions('countries.manage')
@Controller({ path: 'admin/countries', version: '1' })
export class CountriesAdminController {
  constructor(private readonly svc: CountriesAdminService) {}
  @Get() list() { return this.svc.list(); }
  /** Which outside services are connected (keys are set on the server), for the Settings screen. */
  @Get('integrations') integrations() { return this.svc.integrations(); }
  @Patch(':code') update(@Param('code') code: string, @Body() dto: UpdateCountryDto, @CurrentUser() u: AuthUser) { return this.svc.update(code, dto, u); }
}

/**
 * What the website and apps need to render a market: currency, VAT display, payment methods that can really be used,
 * delivery pricing and legal links. Public, cached, no internal fields.
 */
@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly payments: PaymentsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  list() {
    return this.cache.wrap('markets:public', 300, async () => {
      const rows = await this.prisma.country.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, include: { currency: true } });
      return rows.map((c) => {
        const delivery = (c.deliveryConfig ?? {}) as { flatFeeMinor?: string; freeOverMinor?: string | null; label?: string };
        return {
          code: c.code, name: c.name, nameAr: c.nameAr,
          currency: { code: c.currencyCode, symbol: c.currency.symbol, minorUnits: c.currency.minorUnits },
          defaultLocale: c.defaultLocale, locales: c.locales,
          vatRateBps: c.vatRateBps, pricesIncludeTax: c.pricesIncludeTax,
          paymentMethods: c.paymentMethods.filter((m) => this.payments.isAvailable(m)),
          delivery: { flatFeeMinor: delivery.flatFeeMinor ?? null, freeOverMinor: delivery.freeOverMinor ?? null, label: delivery.label ?? null },
          addressFormat: c.addressFormat,
          legal: c.legalSettings,
          // verification codes and social profiles for the website's <head> and Organization data (all public by nature)
          seo: (({ googleVerification, bingVerification, social }) => ({ googleVerification, bingVerification, social }))(parseSeoSettings(c.seoSettings, false)),
          isDefault: c.code === (process.env.DEFAULT_COUNTRY ?? 'QA'),
          guestCheckout: c.guestCheckout,
          // cash on delivery limits the checkout shows before the customer tries (the API enforces them again)
          cod: (() => {
            const r = readCodRules(c.codRules);
            const sms = !!this.notifications?.channelEnabled('SMS');
            return { maxOrderMinor: r.maxOrderMinor, guestPhoneCheck: r.phoneCheck !== 'OFF', accountPhoneCheck: r.phoneCheck === 'ALL', guestAvailable: r.phoneCheck === 'OFF' || sms };
          })(),
          // Which gateway takes cards ("dibsy": its page also offers Apple Pay, Google Pay and Himyan), and whether it is
          // only the sandbox, so apps can word the option honestly.
          cardProvider: this.payments.cardProvider(),
          testPayments: this.payments.cardProvider() === 'test',
          // WhatsApp: order updates can be offered (the API can send them), and the number customers can chat with
          whatsapp: {
            updates: !!this.notifications?.channelEnabled('WHATSAPP'),
            chat: typeof (c.legalSettings as { whatsapp?: unknown } | null)?.whatsapp === 'string' ? ((c.legalSettings as { whatsapp: string }).whatsapp.replace(/[^\d]/g, '') || null) : null,
          },
        };
      });
    });
  }
}

@ApiTags('Markets')
@Controller({ path: 'markets', version: '1' })
export class MarketsController {
  constructor(private readonly svc: MarketsService) {}
  @Public() @Get() list() { return this.svc.list(); }
}

@Module({ imports: [PaymentsModule], controllers: [CountriesAdminController, MarketsController], providers: [CountriesAdminService, MarketsService] })
export class SettingsModule {}
