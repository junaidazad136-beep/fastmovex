import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, Optional, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CacheService } from '../cache/cache.service';
import { CartModule } from '../cart/cart.module';
import { CartService } from '../cart/cart.service';
import { ProductCardService } from '../catalog/product-card.service';
import { AuthUser } from '../common/auth-user';
import { CountryService } from '../common/country/country.service';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { EVENTS, IdEvent } from '../notifications/notification.events';
import { NotificationsService } from '../notifications/notifications.service';
import { formatMoney } from '../notifications/templates';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MAX_LISTS = 20;
const MAX_ITEMS = 500;

class ListDto { @ApiProperty({ example: 'Birthday ideas' }) @Transform(trim) @IsString() @Length(1, 60) name: string; }
class AddItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiPropertyOptional({ description: 'Default list if omitted' }) @IsOptional() @IsUUID() wishlistId?: string;
}
class AlertsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyPriceDrop?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyBackInStock?: boolean;
}
class MoveDto {
  @ApiPropertyOptional({ description: 'Cheapest in-stock variant if omitted' }) @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(99) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() keepInWishlist?: boolean;
}
class ContainsQuery { @ApiProperty({ description: 'Comma-separated product ids (max 100)' }) @Matches(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,99}$/) ids: string; }

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: ProductCardService,
    private readonly cart: CartService,
    private readonly countries: CountryService,
  ) {}

  private async defaultList(userId: string) {
    const found = await this.prisma.wishlist.findFirst({ where: { userId, isDefault: true }, select: { id: true } });
    if (found) return found;
    return this.prisma.wishlist.create({ data: { userId, name: 'My Wishlist', isDefault: true }, select: { id: true } });
  }

  private async ownList(userId: string, id: string) {
    const l = await this.prisma.wishlist.findFirst({ where: { id, userId }, select: { id: true, isDefault: true } });
    if (!l) throw new NotFoundException('Wishlist not found');
    return l;
  }

  async lists(userId: string) {
    await this.defaultList(userId);
    return this.prisma.wishlist.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true, isDefault: true, _count: { select: { items: true } } } });
  }

  async createList(userId: string, name: string) {
    if ((await this.prisma.wishlist.count({ where: { userId } })) >= MAX_LISTS) throw new BadRequestException(`Up to ${MAX_LISTS} lists`);
    return this.prisma.wishlist.create({ data: { userId, name }, select: { id: true, name: true, isDefault: true } });
  }

  async renameList(userId: string, id: string, name: string) {
    await this.ownList(userId, id);
    return this.prisma.wishlist.update({ where: { id }, data: { name }, select: { id: true, name: true } });
  }

  async deleteList(userId: string, id: string) {
    const l = await this.ownList(userId, id);
    if (l.isDefault) throw new BadRequestException('The default wishlist cannot be deleted');
    await this.prisma.wishlist.delete({ where: { id } });
  }

  async items(userId: string, listId: string) {
    await this.ownList(userId, listId);
    const rows = await this.prisma.wishlistItem.findMany({ where: { wishlistId: listId }, orderBy: { addedAt: 'desc' }, take: MAX_ITEMS });
    const cards = await this.cards.hydrate(rows.map((r) => r.productId), { includeAway: true });
    const byId = new Map(cards.map((c) => [c.id, c]));
    return rows.map((r) => {
      const card = byId.get(r.productId) ?? null; // null = product no longer sold (kept so the user sees it)
      const droppedBy = card ? r.priceAtAddMinor - BigInt(card.priceMinor) : 0n;
      return {
        productId: r.productId, addedAt: r.addedAt, notifyPriceDrop: r.notifyPriceDrop, notifyBackInStock: r.notifyBackInStock,
        priceWhenAddedMinor: r.priceAtAddMinor.toString(), priceDroppedByMinor: droppedBy > 0n ? droppedBy.toString() : null,
        available: !!card, product: card,
      };
    });
  }

  async add(userId: string, dto: AddItemDto) {
    const list = dto.wishlistId ? await this.ownList(userId, dto.wishlistId) : await this.defaultList(userId);
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, status: 'ACTIVE', deletedAt: null }, select: { id: true, minPriceMinor: true } });
    if (!product) throw new NotFoundException('Product not found');
    if ((await this.prisma.wishlistItem.count({ where: { wishlistId: list.id } })) >= MAX_ITEMS) throw new BadRequestException('This list is full');
    await this.prisma.wishlistItem.upsert({
      where: { wishlistId_productId: { wishlistId: list.id, productId: product.id } },
      update: {},
      create: { wishlistId: list.id, productId: product.id, priceAtAddMinor: product.minPriceMinor },
    });
    return { wishlistId: list.id, productId: product.id, saved: true };
  }

  async remove(userId: string, productId: string, listId?: string) {
    await this.prisma.wishlistItem.deleteMany({ where: { productId, wishlist: { userId, ...(listId && { id: listId }) } } });
  }

  async setAlerts(userId: string, productId: string, dto: AlertsDto) {
    const res = await this.prisma.wishlistItem.updateMany({ where: { productId, wishlist: { userId } }, data: dto });
    if (!res.count) throw new NotFoundException('Product is not in your wishlist');
    return { productId, ...dto };
  }

  /** Heart icons: which of these products are saved (any list). */
  async contains(userId: string, ids: string[]) {
    const rows = await this.prisma.wishlistItem.findMany({ where: { productId: { in: ids }, wishlist: { userId } }, select: { productId: true } });
    return { saved: [...new Set(rows.map((r) => r.productId))] };
  }

  async moveToCart(userId: string, productId: string, dto: MoveDto, countryHeader?: string) {
    const inList = await this.prisma.wishlistItem.findFirst({ where: { productId, wishlist: { userId } }, select: { id: true } });
    if (!inList) throw new NotFoundException('Product is not in your wishlist');
    let variantId = dto.variantId;
    if (!variantId) {
      const variants = await this.prisma.productVariant.findMany({
        where: { productId, isActive: true },
        orderBy: { priceMinor: 'asc' },
        select: { id: true, inventory: { select: { onHand: true, reserved: true } } },
      });
      variantId = variants.find((v) => (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0) > 0)?.id;
      if (!variantId) throw new ConflictException('This product is out of stock');
    } else {
      const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId }, select: { id: true } });
      if (!v) throw new BadRequestException('Variant does not belong to this product');
    }
    const cart = await this.cart.addItem({ userId, country: await this.countries.resolve(countryHeader) }, variantId, dto.quantity ?? 1);
    if (!dto.keepInWishlist) await this.remove(userId, productId);
    return cart;
  }
}

/**
 * Price-drop and back-in-stock alerts. Triggered by catalog events; each user hears about a product
 * at most once a day, and the saved price moves down so the same drop is never announced twice.
 */
@Injectable()
export class WishlistAlerts {
  private readonly logger = new Logger(WishlistAlerts.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  /** Product link in the customer's language (plain text when the website address is not configured). */
  private link(slug: string, locale: string) {
    const site = this.config?.get('STOREFRONT_URL', { infer: true })?.replace(/\/$/, '');
    return site ? `${site}/${locale === 'ar' ? 'ar' : 'en'}/p/${slug}` : '';
  }

  private async once(key: string) {
    if (await this.cache.get(key)) return false;
    await this.cache.set(key, 1, 86_400);
    return true;
  }

  @OnEvent(EVENTS.PRICE_CHANGED, { async: true })
  async onPriceChanged(e: IdEvent) {
    try {
      const p = await this.prisma.product.findFirst({
        where: { id: e.id, status: 'ACTIVE', deletedAt: null },
        select: { id: true, slug: true, title: true, titleAr: true, minPriceMinor: true, variants: { where: { isActive: true }, select: { currencyCode: true }, take: 1 } },
      });
      if (!p) return;
      const watchers = await this.prisma.wishlistItem.findMany({
        where: { productId: p.id, notifyPriceDrop: true, priceAtAddMinor: { gt: p.minPriceMinor } },
        select: { id: true, wishlist: { select: { userId: true, user: { select: { locale: true } } } } },
        take: 5000,
      });
      const currency = p.variants[0]?.currencyCode ?? 'QAR';
      for (const w of watchers) {
        if (await this.once(`alert:drop:${w.wishlist.userId}:${p.id}`)) {
          const loc = w.wishlist.user.locale;
          await this.notifications.notify(w.wishlist.userId, 'PRICE_DROP', { product: loc === 'ar' ? p.titleAr || p.title : p.title, price: formatMoney(p.minPriceMinor, currency), link: this.link(p.slug, loc) }, { productSlug: p.slug });
        }
      }
      if (watchers.length) await this.prisma.wishlistItem.updateMany({ where: { id: { in: watchers.map((w) => w.id) } }, data: { priceAtAddMinor: p.minPriceMinor } });
    } catch (err) {
      this.logger.error(`price-drop alerts failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(EVENTS.VARIANT_RESTOCKED, { async: true })
  async onRestock(e: IdEvent) {
    try {
      const v = await this.prisma.productVariant.findUnique({ where: { id: e.id }, select: { product: { select: { id: true, slug: true, title: true, titleAr: true, status: true } } } });
      if (!v || v.product.status !== 'ACTIVE') return;
      const watchers = await this.prisma.wishlistItem.findMany({ where: { productId: v.product.id, notifyBackInStock: true }, select: { wishlist: { select: { userId: true, user: { select: { locale: true } } } } }, take: 5000 });
      for (const w of watchers) {
        if (await this.once(`alert:stock:${w.wishlist.userId}:${v.product.id}`)) {
          const loc = w.wishlist.user.locale;
          await this.notifications.notify(w.wishlist.userId, 'BACK_IN_STOCK', { product: loc === 'ar' ? v.product.titleAr || v.product.title : v.product.title, link: this.link(v.product.slug, loc) }, { productSlug: v.product.slug });
        }
      }
    } catch (err) {
      this.logger.error(`back-in-stock alerts failed: ${(err as Error).message}`);
    }
  }
}

@ApiTags('Wishlist')
@ApiBearerAuth()
@Controller({ path: 'wishlists', version: '1' })
export class WishlistController {
  constructor(private readonly svc: WishlistService) {}

  @Get() lists(@CurrentUser() u: AuthUser) { return this.svc.lists(u.id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() d: ListDto) { return this.svc.createList(u.id, d.name); }
  @Get('contains') contains(@CurrentUser() u: AuthUser, @Query() q: ContainsQuery) { return this.svc.contains(u.id, q.ids.split(',')); }
  @Post('items') add(@CurrentUser() u: AuthUser, @Body() d: AddItemDto) { return this.svc.add(u.id, d); }
  @HttpCode(204) @Delete('items/:productId') remove(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) p: string, @Query('wishlistId') l?: string) { return this.svc.remove(u.id, p, l); }
  @Patch('items/:productId/alerts') alerts(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) p: string, @Body() d: AlertsDto) { return this.svc.setAlerts(u.id, p, d); }
  @HttpCode(200) @Post('items/:productId/move-to-cart')
  move(@CurrentUser() u: AuthUser, @Param('productId', ParseUUIDPipe) p: string, @Body() d: MoveDto, @Headers('x-country') c?: string) { return this.svc.moveToCart(u.id, p, d, c); }
  @Get(':id') items(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.items(u.id, id); }
  @Patch(':id') rename(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ListDto) { return this.svc.renameList(u.id, id, d.name); }
  @HttpCode(204) @Delete(':id') del(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteList(u.id, id); }
}

@Module({ imports: [CartModule], controllers: [WishlistController], providers: [WishlistService, WishlistAlerts] })
export class WishlistModule {}
