import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public } from '../common/decorators/auth.decorators';
import { CountryService } from '../common/country/country.service';
import { CartContext, CartService } from './cart.service';
import { AddCartItemDto, ApplyCouponDto, MergeCartDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Works for guests and logged-in users.
 * Guests: first add returns `cartToken`; send it back as `X-Cart-Token` on every cart call.
 * After login: POST /cart/merge with that token, then drop it.
 * The client never sends prices — only variantId + quantity.
 */
@ApiTags('Cart')
@ApiHeader({ name: 'X-Cart-Token', required: false, description: 'Guest cart token' })
@ApiHeader({ name: 'X-Country', required: false })
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly countries: CountryService,
  ) {}

  private async ctx(user: AuthUser | undefined, token: string | undefined, country: string | undefined): Promise<CartContext> {
    return { country: await this.countries.resolve(country), userId: user?.id, guestToken: user ? undefined : token };
  }

  @Public() @Get()
  async get(@CurrentUser() u?: AuthUser, @Headers('x-cart-token') t?: string, @Headers('x-country') c?: string) {
    return this.cart.view(await this.ctx(u, t, c));
  }

  @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Post('items')
  async add(@Body() dto: AddCartItemDto, @CurrentUser() u?: AuthUser, @Headers('x-cart-token') t?: string, @Headers('x-country') c?: string) {
    return this.cart.addItem(await this.ctx(u, t, c), dto.variantId, dto.quantity);
  }

  /** "Buy now": a separate one-item cart for an immediate checkout; the customer's own cart is not changed. */
  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Post('buy-now')
  async buyNow(@Body() dto: AddCartItemDto, @Headers('x-country') c?: string) {
    return this.cart.buyNow(await this.countries.resolve(c), dto.variantId, dto.quantity);
  }

  /** The "buy now" cart (token in X-Buy-Now-Token), priced like the cart. */
  @Public() @Get('buy-now')
  async buyNowView(@Headers('x-buy-now-token') token?: string, @Headers('x-country') c?: string) {
    if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new BadRequestException('Missing buy-now token');
    return this.cart.view({ country: await this.countries.resolve(c), guestToken: token });
  }

  @Public() @Patch('items/:itemId')
  async update(@Param('itemId', ParseUUIDPipe) id: string, @Body() dto: UpdateCartItemDto, @CurrentUser() u?: AuthUser, @Headers('x-cart-token') t?: string, @Headers('x-country') c?: string) {
    return this.cart.updateItem(await this.ctx(u, t, c), id, dto.quantity);
  }

  @Public() @Delete('items/:itemId')
  async remove(@Param('itemId', ParseUUIDPipe) id: string, @CurrentUser() u?: AuthUser, @Headers('x-cart-token') t?: string, @Headers('x-country') c?: string) {
    return this.cart.removeItem(await this.ctx(u, t, c), id);
  }

  @Public() @Delete()
  async clear(@CurrentUser() u?: AuthUser, @Headers('x-cart-token') t?: string, @Headers('x-country') c?: string) {
    return this.cart.clear(await this.ctx(u, t, c));
  }

  @Public() @Post('acknowledge-prices')
  async ack(@CurrentUser() u?: AuthUser, @Headers('x-cart-token') t?: string, @Headers('x-country') c?: string) {
    return this.cart.acknowledgePrices(await this.ctx(u, t, c));
  }

  /** Coupons need login (per-customer limits). Brute-force guessing is rate limited. */
  @ApiBearerAuth() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('coupon')
  async applyCoupon(@Body() dto: ApplyCouponDto, @CurrentUser() u: AuthUser, @Headers('x-country') c?: string) {
    return this.cart.applyCoupon(await this.ctx(u, undefined, c), dto.code);
  }

  @ApiBearerAuth() @Delete('coupon')
  async removeCoupon(@CurrentUser() u: AuthUser, @Headers('x-country') c?: string) {
    return this.cart.removeCoupon(await this.ctx(u, undefined, c));
  }

  @ApiBearerAuth() @Post('merge')
  async merge(@Body() dto: MergeCartDto, @CurrentUser() u: AuthUser, @Headers('x-country') c?: string) {
    return this.cart.merge(u.id, dto.guestToken, await this.countries.resolve(c));
  }
}
