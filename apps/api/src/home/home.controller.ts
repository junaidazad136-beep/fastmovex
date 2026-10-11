import { Body, Controller, Get, Headers, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { CountryService } from '../common/country/country.service';
import { HomeQueryDto } from './dto/home.dto';
import { HomeService } from './home.service';

@ApiTags('Home')
@ApiHeader({ name: 'X-Country', required: false })
@Controller({ version: '1' })
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly countries: CountryService,
  ) {}

  /** Works for guests. With a token it adds "Recently viewed" and "Recommended". With lat/lng it adds "Nearby sellers". */
  @Public() @Get('home')
  async feed(@Query() q: HomeQueryDto, @CurrentUser() user?: AuthUser, @Headers('x-country') country?: string) {
    const geo = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.home.feed(await this.countries.resolve(country), user?.id, geo);
  }

  @ApiBearerAuth() @Get('me/recently-viewed')
  recentlyViewed(@CurrentUser() user: AuthUser) {
    return this.home.recentlyViewed(user.id, 50);
  }
}

class LayoutQuery {
  @ApiPropertyOptional({ default: 'QA' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Length(2, 2) country?: string;
}
class LayoutSectionDto {
  @ApiProperty({ example: 'best_sellers', description: 'A built-in section key or "collection"' }) @IsString() @Length(2, 40) key: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) title?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) titleAr?: string | null;
  @ApiPropertyOptional({ description: 'Collection settings: { source, categoryId?, tag?, productIds?, sort?, limit? }' }) @IsOptional() @IsObject() config?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class LayoutDto {
  @ApiProperty({ example: 'QA' }) @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Length(2, 2) countryCode: string;
  @ApiProperty({ type: [LayoutSectionDto] }) @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => LayoutSectionDto) sections: LayoutSectionDto[];
}
class ResetDto {
  @ApiProperty({ example: 'QA' }) @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Length(2, 2) countryCode: string;
}
class PreviewDto {
  @ApiProperty() @IsObject() config: Record<string, unknown>;
}

@ApiTags('Home')
@ApiHeader({ name: 'X-Country', required: false })
@Controller({ version: '1' })
export class OffersController {
  constructor(private readonly home: HomeService, private readonly countries: CountryService) {}

  /** Live sales with their deals, then other discounted products. */
  @Public() @Get('offers')
  async offers(@Headers('x-country') country?: string) {
    return this.home.offers(await this.countries.resolve(country));
  }
}

@ApiTags('Admin / Home page') @ApiBearerAuth()
@Controller({ path: 'admin/home-sections', version: '1' })
export class AdminHomeController {
  constructor(private readonly home: HomeService, private readonly countries: CountryService) {}

  @RequirePermissions('banners.manage') @Get()
  get(@Query() q: LayoutQuery) { return this.home.layout(q.country ?? 'QA'); }

  @RequirePermissions('banners.manage') @Put()
  save(@Body() d: LayoutDto, @CurrentUser() u: AuthUser) { return this.home.saveLayout(d.countryCode, d.sections, u); }

  @RequirePermissions('banners.manage') @HttpCode(200) @Post('reset')
  reset(@Body() d: ResetDto, @CurrentUser() u: AuthUser) { return this.home.resetLayout(d.countryCode, u); }

  @RequirePermissions('banners.manage') @HttpCode(200) @Post('preview')
  async preview(@Body() d: PreviewDto, @Headers('x-country') country?: string) {
    return this.home.previewCollection(await this.countries.resolve(country), d.config);
  }
}
