import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { randomBytes, randomUUID } from 'crypto';
import { AddressDto, assertAddressFormat } from '../addresses/addresses';
import { AuditService } from '../audit/audit.service';
import { CartService } from '../cart/cart.service';
import { AuthUser } from '../common/auth-user';
import { CountryInfo, CountryService } from '../common/country/country.service';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const E164 = /^\+[1-9]\d{7,14}$/;
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'CATALOG_MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'SUPPORT_ADMIN', 'DELIVERY_AGENT', 'SELLER'];

class PhoneCustomerDto {
  @ApiPropertyOptional({ description: 'An existing customer (from the customer search)' }) @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ example: 'Fatima Al-Kuwari' }) @IsOptional() @Transform(trim) @IsString() @Length(2, 100) fullName?: string;
  @ApiPropertyOptional({ example: '+97455551234' }) @IsOptional() @Transform(trim) @Matches(E164, { message: 'phone must be in international format, e.g. +97455555555' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(200) email?: string;
}
class PhoneItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity: number;
}
export class PhoneOrderDto {
  @ApiProperty({ type: PhoneCustomerDto }) @ValidateNested() @Type(() => PhoneCustomerDto) customer: PhoneCustomerDto;
  @ApiProperty({ type: [PhoneItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PhoneItemDto) items: PhoneItemDto[];
  @ApiPropertyOptional({ description: 'One of the customer’s saved addresses' }) @IsOptional() @IsUUID() addressId?: string;
  @ApiPropertyOptional({ type: AddressDto }) @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
  @ApiPropertyOptional({ description: 'Keep the new address in the customer’s address book' }) @IsOptional() @IsBoolean() saveAddress?: boolean;
  @ApiPropertyOptional({ example: '2026-10-09T13:00:00.000Z' }) @IsOptional() @IsISO8601({ strict: true }) deliverySlot?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ description: 'A promo code the caller gave (same rules as on the website, judged for this customer)', example: 'WELCOME10' })
  @IsOptional() @Transform(trim) @IsString() @Length(2, 40) couponCode?: string;
}
class CustomerSearchQuery { @ApiProperty({ example: '+9745555' }) @Transform(trim) @IsString() @Length(3, 100) q: string; }

/**
 * Orders taken on the phone (or WhatsApp) by staff for a customer: an existing account, or a new customer by phone
 * number. Priced exactly like a website order (same cart engine, stock, deals, delivery fee, cash-on-delivery rules),
 * paid cash on delivery, and marked with who took it.
 */
@Injectable()
export class PhoneOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
    private readonly audit: AuditService,
  ) {}

  /** Find the caller: by phone, email or name. Staff accounts are never offered. */
  async searchCustomers(q: string) {
    const digits = q.replace(/[\s-]/g, '');
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null, status: 'ACTIVE', roles: { none: { role: { code: { in: STAFF_ROLES } } } },
        OR: [{ phone: { contains: digits } }, { email: { contains: q.toLowerCase() } }, { fullName: { contains: q, mode: 'insensitive' } }],
      },
      take: 10, orderBy: { createdAt: 'desc' },
      select: {
        id: true, fullName: true, phone: true, email: true, isGuest: true, tags: true, codBlocked: true,
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], take: 5, select: { id: true, label: true, recipientName: true, phone: true, city: true, zone: true, street: true, building: true, unit: true, line1: true } },
        _count: { select: { orders: true } },
      },
    });
    return rows.map(({ _count, ...u }) => ({ ...u, orders: _count.orders }));
  }

  /** Products to add while on the phone: active, sold in this market, with what is free to sell. */
  async searchProducts(q: string, country: CountryInfo) {
    const rows = await this.prisma.productVariant.findMany({
      where: {
        isActive: true,
        product: { status: 'ACTIVE', deletedAt: null, countryCode: country.code, store: { isActive: true, seller: { status: 'APPROVED' } } },
        OR: [{ sku: { contains: q, mode: 'insensitive' } }, { barcode: q }, { product: { title: { contains: q, mode: 'insensitive' } } }, { product: { titleAr: { contains: q } } }],
      },
      take: 20, orderBy: { product: { title: 'asc' } },
      select: {
        id: true, sku: true, priceMinor: true, optionValues: true, inventory: { select: { onHand: true, reserved: true } },
        product: { select: { title: true, store: { select: { name: true } }, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { fileKey: true } } } },
      },
    });
    return rows.map((v) => ({
      variantId: v.id, sku: v.sku, title: v.product.title, options: v.optionValues, store: v.product.store.name, priceMinor: v.priceMinor.toString(), currencyCode: country.currencyCode,
      available: Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)),
    }));
  }

  /** The customer the order is for: an existing one, the account that has this phone, or a new guest profile. */
  private async customer(c: PhoneCustomerDto, country: CountryInfo, create: boolean) {
    const pick = { id: true, fullName: true, phone: true, email: true, isGuest: true, status: true, deletedAt: true, roles: { select: { role: { select: { code: true } } } } } as const;
    let u = c.userId ? await this.prisma.user.findUnique({ where: { id: c.userId }, select: pick }) : null;
    if (c.userId && !u) throw new NotFoundException('Customer not found');
    if (!u && c.phone) u = await this.prisma.user.findUnique({ where: { phone: c.phone }, select: pick });
    if (!u && c.email) u = await this.prisma.user.findUnique({ where: { email: c.email }, select: pick });
    if (u) {
      if (u.deletedAt || u.status !== 'ACTIVE') throw new ForbiddenException('This customer account cannot order');
      if (u.roles.some((r) => STAFF_ROLES.includes(r.role.code))) throw new ForbiddenException('Phone orders are for customers, not staff accounts');
      return { id: u.id, fullName: u.fullName, phone: u.phone, email: u.email, isGuest: u.isGuest, isNew: false };
    }
    if (!c.fullName || !c.phone) throw new BadRequestException({ message: 'New customer: enter their name and mobile number', reason: 'CUSTOMER_DETAILS' });
    if (!create) return { id: null, fullName: c.fullName, phone: c.phone, email: c.email ?? null, isGuest: true, isNew: true };
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' }, select: { id: true } });
    const made = await this.prisma.user.create({
      data: { fullName: c.fullName, phone: c.phone, email: c.email ?? null, isGuest: true, countryCode: country.code, locale: 'en', roles: { create: { roleId: role.id } } },
      select: { id: true },
    });
    return { id: made.id, fullName: c.fullName, phone: c.phone, email: c.email ?? null, isGuest: true, isNew: true };
  }

  /** A cart that only lives for this request (never shown to anyone, deleted afterwards). */
  private async tempCart(country: CountryInfo, items: PhoneItemDto[], coupon?: { code?: string; for: string | 'NEW' }) {
    const ctx = { country, guestToken: `phone_${randomBytes(18).toString('base64url')}`, couponFor: coupon?.for };
    await this.prisma.cart.create({ data: { guestToken: ctx.guestToken, countryCode: country.code, currencyCode: country.currencyCode } });
    const seen = new Set<string>();
    try {
      for (const it of items) {
        if (seen.has(it.variantId)) throw new BadRequestException('Each product only once (change the quantity instead)');
        seen.add(it.variantId);
        await this.cart.addItem(ctx, it.variantId, it.quantity);
      }
      // the promo code is judged for this customer (their own limits, first order, new customers)
      if (coupon?.code) await this.cart.applyCoupon(ctx, coupon.code);
    } catch (e) {
      await this.dropCart(ctx.guestToken);
      throw e;
    }
    return ctx;
  }

  private dropCart(token: string) {
    return this.prisma.cart.deleteMany({ where: { guestToken: token } });
  }

  private async address(dto: PhoneOrderDto, userId: string | null, country: CountryInfo, fallbackName: string) {
    if (dto.addressId) {
      if (!userId) throw new BadRequestException('Saved addresses belong to an existing customer');
      const a = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
      if (!a) throw new NotFoundException('Address not found');
      return a as unknown as Record<string, unknown> & { countryCode: string };
    }
    if (!dto.address) throw new BadRequestException('Choose or enter the delivery address');
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: country.code }, select: { addressFormat: true } });
    assertAddressFormat(dto.address, market.addressFormat);
    if (dto.address.countryCode && dto.address.countryCode !== country.code) throw new BadRequestException('The address must be in this market');
    const { isDefault: _d, label: _l, ...a } = dto.address;
    return { ...a, countryCode: country.code, recipientName: a.recipientName || fallbackName };
  }

  /** What the order would cost, line by line, without placing it. */
  async quote(dto: PhoneOrderDto, country: CountryInfo) {
    const who = await this.customer(dto.customer, country, false);
    const ctx = await this.tempCart(country, dto.items, { code: dto.couponCode, for: who.id ?? 'NEW' });
    try {
      const view = await this.cart.view(ctx);
      return { customer: who, cart: view };
    } finally {
      await this.dropCart(ctx.guestToken);
    }
  }

  async place(dto: PhoneOrderDto, country: CountryInfo, staff: AuthUser, idempotencyKey: string) {
    const key = `phone_${idempotencyKey}`;
    const again = await this.prisma.order.findUnique({ where: { idempotencyKey: key }, select: { id: true, placedById: true } });
    if (again) {
      if (again.placedById !== staff.id) throw new ConflictException('This request was already used. Please try again.');
      return this.checkout.result(again.id, { reused: true });
    }
    const who = await this.customer(dto.customer, country, true);
    const address = await this.address(dto, who.id, country, who.fullName);
    const ctx = await this.tempCart(country, dto.items, { code: dto.couponCode, for: who.id! });
    let result: Awaited<ReturnType<CheckoutService['place']>>;
    try {
      result = await this.checkout.place({
        userId: who.id!, cart: ctx, country, address,
        dto: { paymentMethod: 'COD', note: dto.note, deliverySlot: dto.deliverySlot },
        idempotencyKey: key, phoneConfirmedByStaff: true,
      });
    } finally {
      await this.dropCart(ctx.guestToken);
    }
    const orderId = (result as { id: string }).id;
    await this.prisma.order.update({ where: { id: orderId }, data: { placedById: staff.id } });
    if (dto.saveAddress && dto.address && !who.isGuest) {
      const { isDefault: _d, ...a } = dto.address;
      await this.prisma.address.create({ data: { ...a, countryCode: country.code, userId: who.id!, isDefault: false } as Prisma.AddressUncheckedCreateInput }).catch(() => undefined);
    }
    await this.audit.log({ actorId: staff.id, action: 'order.phone_order', entityType: 'Order', entityId: orderId, after: { orderNumber: (result as { orderNumber: string }).orderNumber, customerId: who.id, newCustomer: who.isNew, couponCode: dto.couponCode ?? null } });
    return { ...result, customer: { id: who.id, fullName: who.fullName, isNew: who.isNew } };
  }
}

@ApiTags('Admin / Orders') @ApiBearerAuth()
@Controller({ path: 'admin/phone-orders', version: '1' })
export class PhoneOrdersController {
  constructor(private readonly svc: PhoneOrdersService, private readonly countries: CountryService) {}

  @RequirePermissions('orders.create') @Get('customers') customers(@Query() q: CustomerSearchQuery) { return this.svc.searchCustomers(q.q); }
  @RequirePermissions('orders.create') @Get('products')
  async products(@Query() q: CustomerSearchQuery, @Headers('x-country') c?: string) { return this.svc.searchProducts(q.q, await this.countries.resolve(c)); }

  /** Price check: lines, deals, delivery fee and total — nothing is reserved. */
  @RequirePermissions('orders.create') @HttpCode(200) @Post('quote')
  async quote(@Body() d: PhoneOrderDto, @Headers('x-country') c?: string) { return this.svc.quote(d, await this.countries.resolve(c)); }

  /** Places the order for the customer (cash on delivery). Send the same Idempotency-Key when retrying. */
  @RequirePermissions('orders.create') @ApiHeader({ name: 'Idempotency-Key', required: false }) @Post()
  async place(@Body() d: PhoneOrderDto, @CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string, @Headers('x-country') c?: string) {
    return this.svc.place(d, await this.countries.resolve(c), u, key?.slice(0, 64) || randomUUID());
  }
}
