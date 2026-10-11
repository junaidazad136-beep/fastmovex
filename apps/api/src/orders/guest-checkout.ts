import { OrderTrafficDto } from '../analytics/traffic';
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, Optional, Param, Post, Req,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { OtpService } from '../auth/otp.service';
import { CodGuardService } from '../cash/cod-rules';
import { ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentMethod, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { AddressDto, assertAddressFormat } from '../addresses/addresses';
import { AuditService } from '../audit/audit.service';
import { Public } from '../common/decorators/auth.decorators';
import { CountryInfo, CountryService } from '../common/country/country.service';
import { OrderAccessService } from '../common/order-access.service';
import { requestMeta } from '../common/utils/request-meta';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';
import { CancelDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const E164 = /^\+[1-9]\d{7,14}$/;

export class GuestContactDto {
  @ApiProperty({ example: 'Sara Ahmed' }) @Transform(trim) @IsString() @Length(2, 100) fullName: string;
  @ApiProperty({ example: 'sara@example.com', description: 'Order confirmation and tracking link are sent here' })
  @Transform(lower) @IsEmail() @MaxLength(200) email: string;
  @ApiProperty({ example: '+97455555555' }) @Transform(trim) @Matches(E164, { message: 'phone must be in international format, e.g. +97455555555' }) phone: string;
  @ApiPropertyOptional({ description: 'Offers by email/SMS — only with explicit consent' }) @IsOptional() @IsBoolean() marketingOptIn?: boolean;
  @ApiPropertyOptional({ description: 'Order updates on WhatsApp to this phone — only with explicit consent' }) @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @ApiPropertyOptional({ enum: ['en', 'ar'] }) @IsOptional() @IsIn(['en', 'ar']) locale?: 'en' | 'ar';
  @ApiPropertyOptional({ example: '123456', description: 'Cash on delivery: the code texted by POST /checkout/guest/phone-code' })
  @IsOptional() @Matches(/^\d{6}$/, { message: 'The code has 6 digits' }) phoneCode?: string;
}

export class GuestCheckoutDto {
  @ApiProperty({ type: GuestContactDto }) @ValidateNested() @Type(() => GuestContactDto) contact: GuestContactDto;
  @ApiProperty({ type: AddressDto }) @ValidateNested() @Type(() => AddressDto) address: AddressDto;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) returnUrl?: string;
  @ApiPropertyOptional({ example: '2026-10-02T06:00:00.000Z', description: 'Start of the delivery window from GET /delivery/slots' })
  @IsOptional() @IsISO8601({ strict: true }) deliverySlot?: string;
  @ApiPropertyOptional({ type: OrderTrafficDto }) @IsOptional() @ValidateNested() @Type(() => OrderTrafficDto) traffic?: OrderTrafficDto;
}

export class OrderLookupDto {
  @ApiProperty({ example: 'FMX-QA-260930-3B6AFE' }) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @IsString() @Length(8, 40) orderNumber: string;
  @ApiProperty({ description: 'Email or phone used for the order' }) @Transform(lower) @IsString() @Length(5, 200) contact: string;
}

@Injectable()
export class GuestCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly access: OrderAccessService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    @Optional() private readonly cod?: CodGuardService,
    @Optional() private readonly otp?: OtpService,
  ) {}

  /**
   * Cash on delivery as a guest: the mobile number is proven with a texted code first (market rule codRules.phoneCheck),
   * so nobody can send a driver to a made-up number. Once proven, the guest profile remembers the number.
   */
  async sendPhoneCode(country: CountryInfo, c: GuestContactDto, ip?: string) {
    const rules = await this.cod!.rules(country.code);
    if (rules.phoneCheck === 'OFF') return { required: false };
    if (!this.cod!.smsAvailable()) throw new ServiceUnavailableException({ message: 'We cannot send text messages right now. Please pay by card, or sign in to pay cash.', reason: 'SMS_OFF' });
    const guest = await this.guestFor(country, c);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: guest.id }, select: { phone: true, phoneVerifiedAt: true, locale: true } });
    if (u.phone === c.phone && u.phoneVerifiedAt) return { required: false, verified: true };
    const sent = await this.otp!.issue({ id: guest.id, locale: c.locale ?? u.locale }, 'VERIFY_PHONE', 'SMS', c.phone, ip);
    return { required: true, ...sent };
  }

  private async assertPhoneProven(country: CountryInfo, guestId: string, c: GuestContactDto) {
    if (!this.cod || !this.otp) return;
    const rules = await this.cod.rules(country.code);
    if (rules.phoneCheck === 'OFF') return;
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: guestId }, select: { phone: true, phoneVerifiedAt: true } });
    if (u.phone === c.phone && u.phoneVerifiedAt) return;
    if (!this.cod.smsAvailable()) {
      throw new ForbiddenException({ message: 'Cash on delivery needs a text-message check that is not available right now. Please pay by card, or sign in.', reason: 'COD_NEEDS_SMS' });
    }
    if (!c.phoneCode) throw new BadRequestException({ message: 'Confirm your mobile number with the code we text you to pay cash on delivery.', reason: 'COD_PHONE_CODE' });
    const target = await this.otp.verify(guestId, 'VERIFY_PHONE', c.phoneCode);
    if (target !== c.phone) throw new BadRequestException({ message: 'The code is wrong or has expired. Ask for a new code.', reason: 'COD_PHONE_CODE' });
    const owner = await this.prisma.user.findUnique({ where: { phone: c.phone }, select: { id: true } });
    if (!owner || owner.id === guestId) await this.prisma.user.update({ where: { id: guestId }, data: { phone: c.phone, phoneVerifiedAt: new Date() } });
  }

  async place(country: CountryInfo, cartToken: string | undefined, dto: GuestCheckoutDto, idempotencyKey: string, meta: { ip?: string }) {
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: country.code }, select: { guestCheckout: true, addressFormat: true } });
    if (!market.guestCheckout) throw new ForbiddenException({ message: 'Please sign in or create an account to order', reason: 'GUEST_CHECKOUT_OFF' });
    if (!cartToken) throw new BadRequestException('Your cart is empty');
    if (dto.address.countryCode && dto.address.countryCode !== country.code) throw new BadRequestException('This address is in a different country');
    assertAddressFormat(dto.address, market.addressFormat);

    const guest = await this.guestFor(country, dto.contact);
    const existing = await this.checkout.existingFor(idempotencyKey, guest.id);
    if (existing) return this.withToken(await this.checkout.result(existing, { reused: true }));
    if (dto.paymentMethod === 'COD') await this.assertPhoneProven(country, guest.id, dto.contact);

    // Remember the cart so a declined card can put the items straight back into this browser's cart.
    const cart = await this.prisma.cart.findUnique({ where: { guestToken: cartToken }, select: { id: true, userId: true, countryCode: true, items: { select: { variantId: true, quantity: true, priceSnapshotMinor: true } } } });
    if (!cart || cart.userId || cart.countryCode !== country.code || !cart.items.length) throw new BadRequestException('Your cart is empty');

    const { isDefault: _d, label: _l, ...address } = dto.address;
    const result = await this.checkout.place({
      userId: guest.id,
      cart: { guestToken: cartToken, country },
      country,
      address: { ...address, countryCode: country.code, recipientName: address.recipientName || dto.contact.fullName },
      dto: { paymentMethod: dto.paymentMethod, note: dto.note, returnUrl: dto.returnUrl, deliverySlot: dto.deliverySlot, traffic: dto.traffic },
      idempotencyKey,
    });

    const failed = (result as { payment?: { status?: string } }).payment?.status === 'FAILED';
    if (failed) {
      for (const i of cart.items) {
        await this.prisma.cartItem.upsert({
          where: { cartId_variantId: { cartId: cart.id, variantId: i.variantId } },
          update: {},
          create: { cartId: cart.id, variantId: i.variantId, quantity: i.quantity, priceSnapshotMinor: i.priceSnapshotMinor },
        });
      }
    }
    await this.audit.log({ actorId: guest.id, action: 'order.guest_checkout', entityType: 'Order', entityId: (result as { id: string }).id, ip: meta.ip });
    return this.withToken(result);
  }

  /** The order page for a guest: the token from checkout (or from the email link / lookup) opens it. */
  async view(orderNumber: string, token: string | undefined) {
    const o = await this.authorise(orderNumber, token);
    return { ...(await this.orders.detailForCustomer(o.userId, orderNumber)), guest: true };
  }

  async cancel(orderNumber: string, token: string | undefined, reason: string) {
    const o = await this.authorise(orderNumber, token);
    return { ...(await this.orders.cancelByCustomer(o.userId, orderNumber, reason)), guest: true };
  }

  /**
   * "Track my order" without an account: order number + the email or phone used. Same answer for every mismatch,
   * and the route is rate limited, so order numbers cannot be probed.
   */
  async lookup(dto: OrderLookupDto) {
    const o = await this.prisma.order.findUnique({
      where: { orderNumber: dto.orderNumber },
      select: { id: true, orderNumber: true, shippingAddress: true, user: { select: { email: true, phone: true } } },
    });
    const contact = dto.contact.replace(/\s/g, '');
    const shipPhone = (o?.shippingAddress as { phone?: string } | null)?.phone;
    const matches = !!o && [o.user.email, o.user.phone, shipPhone].some((v) => !!v && v.toLowerCase() === contact);
    if (!o || !matches) throw new UnauthorizedException('We could not find an order with these details');
    return { orderNumber: o.orderNumber, token: this.access.sign(o.id) };
  }

  private async authorise(orderNumber: string, token: string | undefined) {
    const o = await this.prisma.order.findUnique({ where: { orderNumber: orderNumber.toUpperCase() }, select: { id: true, userId: true } });
    if (!o || !this.access.verify(o.id, token)) throw new UnauthorizedException('This link has expired or is not valid. Look the order up with its number and your email.');
    return o;
  }

  private withToken<T extends { id: string }>(result: T) {
    return { ...result, orderAccessToken: this.access.sign(result.id) };
  }

  /**
   * One guest profile per email. An email that belongs to a registered account must sign in instead — otherwise
   * anyone could attach orders (and see them later) under somebody else's account.
   */
  private async guestFor(country: CountryInfo, c: GuestContactDto) {
    const byEmail = await this.prisma.user.findUnique({ where: { email: c.email }, select: { id: true, isGuest: true, status: true, phone: true, deletedAt: true } });
    if (byEmail && (!byEmail.isGuest || byEmail.deletedAt)) {
      throw new ConflictException({ message: 'You already have an account with this email. Please sign in to order.', reason: 'ACCOUNT_EXISTS' });
    }
    if (byEmail && byEmail.status !== 'ACTIVE') throw new ForbiddenException('This email cannot be used to order. Please contact us.');

    // The phone is stored only when no other profile uses it (it is unique); the delivery address always keeps it.
    const phoneOwner = await this.prisma.user.findUnique({ where: { phone: c.phone }, select: { id: true } });
    const phone = !phoneOwner || phoneOwner.id === byEmail?.id ? c.phone : undefined;

    if (byEmail) {
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: { fullName: c.fullName, ...(phone && !byEmail.phone && { phone }), ...(c.marketingOptIn && { marketingOptIn: true }), ...(c.whatsappOptIn && phone && { whatsappOptIn: true, whatsappOptInAt: new Date() }), ...(c.locale && { locale: c.locale }) },
        select: { id: true },
      });
    }
    const customer = await this.prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' }, select: { id: true } });
    try {
      return await this.prisma.user.create({
        data: {
          fullName: c.fullName, email: c.email, phone: phone ?? null, isGuest: true, countryCode: country.code, locale: c.locale ?? 'en',
          marketingOptIn: !!c.marketingOptIn, roles: { create: { roleId: customer.id } },
          ...(c.whatsappOptIn && phone && { whatsappOptIn: true, whatsappOptInAt: new Date() }),
        },
        select: { id: true },
      });
    } catch (e) {
      // Two first orders with the same email at the same moment: use the profile the other request created.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.user.findUnique({ where: { email: c.email }, select: { id: true, isGuest: true } });
        if (again?.isGuest) return { id: again.id };
      }
      throw e;
    }
  }
}

@ApiTags('Checkout')
@Controller({ path: 'checkout', version: '1' })
export class GuestCheckoutController {
  constructor(private readonly guest: GuestCheckoutService, private readonly countries: CountryService) {}

  /** Order without an account. Uses the guest cart (`X-Cart-Token`). The answer carries `orderAccessToken` for the order page. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Cart-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @Post('guest')
  async place(
    @Body() dto: GuestCheckoutDto,
    @Req() req: Request,
    @Headers('x-cart-token') cartToken?: string,
    @Headers('idempotency-key') key?: string,
    @Headers('x-country') country?: string,
  ) {
    return this.guest.place(await this.countries.resolve(country), cartToken, dto, key?.slice(0, 64) || randomUUID(), requestMeta(req));
  }

  /** Texts a 6-digit code to the guest's mobile before a cash-on-delivery order. `required: false` = no code needed. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('guest/phone-code')
  async phoneCode(@Body() dto: GuestContactDto, @Req() req: Request, @Headers('x-country') country?: string) {
    return this.guest.sendPhoneCode(await this.countries.resolve(country), dto, requestMeta(req).ip);
  }
}

@ApiTags('Orders')
@Controller({ path: 'orders/guest', version: '1' })
export class GuestOrdersController {
  constructor(private readonly guest: GuestCheckoutService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(200)
  @Post('lookup')
  lookup(@Body() dto: OrderLookupDto) { return this.guest.lookup(dto); }

  @Public()
  @ApiHeader({ name: 'X-Order-Token', required: true, description: 'orderAccessToken from checkout, the email link or lookup' })
  @Get(':orderNumber')
  view(@Param('orderNumber') n: string, @Headers('x-order-token') token?: string) { return this.guest.view(n, token); }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @HttpCode(200)
  @Post(':orderNumber/cancel')
  cancel(@Param('orderNumber') n: string, @Body() dto: CancelDto, @Headers('x-order-token') token?: string) { return this.guest.cancel(n, token, dto.reason); }
}
