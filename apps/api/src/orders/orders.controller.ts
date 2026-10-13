import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CountryService } from '../common/country/country.service';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { CartService } from '../cart/cart.service';
import { CheckoutService } from './checkout.service';
import { CancelDto, CheckoutDto, OrdersQuery, UpdateSellerOrderStatusDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('Checkout')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Send the same key when retrying — you will get the same order back, never a second one' })
@Controller({ path: 'checkout', version: '1' })
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly countries: CountryService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  async place(
    @CurrentUser() user: AuthUser,
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') key?: string,
    @Headers('x-country') country?: string,
  ) {
    return this.checkout.checkout(user.id, await this.countries.resolve(country), dto, key?.slice(0, 64) || randomUUID());
  }
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly cart: CartService, private readonly countries: CountryService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query() q: OrdersQuery) { return this.orders.listForCustomer(u.id, q); }
  @Get(':orderNumber') detail(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string) { return this.orders.detailForCustomer(u.id, n); }

  @HttpCode(200) @Post(':orderNumber/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Body() dto: CancelDto) {
    return this.orders.cancelByCustomer(u.id, n, dto.reason);
  }

  /** Buy again: the order's items go back in the cart (today's price, as many as are in stock); the rest are listed. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200) @Post(':orderNumber/buy-again')
  async buyAgain(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Headers('x-country') c?: string) {
    const lines = await this.orders.buyAgainLines(u.id, n);
    return this.cart.addLines({ userId: u.id, country: await this.countries.resolve(c) }, lines);
  }
}

@ApiTags('Seller / Orders')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@Controller({ path: 'seller/orders', version: '1' })
export class SellerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() list(@CurrentSeller() s: SellerContext, @Query() q: OrdersQuery) { return this.orders.listForSeller(s.id, q); }
  /** Seller Center home: orders by stage, newest new order, products by status (before :id so "summary" is not an id). */
  @Get('summary') summary(@CurrentSeller() s: SellerContext) { return this.orders.sellerSummary(s.id); }
  @Get(':id') detail(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string) { return this.orders.detailForSeller(s.id, id); }

  @HttpCode(200) @Post(':id/status')
  status(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSellerOrderStatusDto, @CurrentUser() u: AuthUser) {
    return this.orders.updateSellerOrderStatus(s.id, id, dto.status, u.id, dto.note);
  }

  @HttpCode(200) @Post(':id/cancel')
  cancel(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto, @CurrentUser() u: AuthUser) {
    return this.orders.cancelBySeller(s.id, id, u.id, dto.reason);
  }
}

@ApiTags('Admin / Orders')
@ApiBearerAuth()
@Controller({ path: 'admin/orders', version: '1' })
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @RequirePermissions('orders.read') @Get() list(@Query() q: OrdersQuery) { return this.orders.listForAdmin(q); }
  @RequirePermissions('orders.read') @Get(':orderNumber') detail(@Param('orderNumber') n: string) { return this.orders.detailForAdmin(n); }

  @RequirePermissions('orders.cancel') @HttpCode(200) @Post(':orderNumber/cancel')
  cancel(@Param('orderNumber') n: string, @Body() dto: CancelDto, @CurrentUser() u: AuthUser) {
    return this.orders.cancelByAdmin(n, u.id, dto.reason);
  }

  /** Staff fulfil shipments (FastMoveX's own store, or on behalf of a seller). Same status machine as sellers, stock committed on ship. */
  @RequirePermissions('orders.update') @HttpCode(200) @Post('shipments/:id/status')
  shipmentStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSellerOrderStatusDto, @CurrentUser() u: AuthUser) {
    return this.orders.staffShipmentStatus(id, dto, u);
  }
}
