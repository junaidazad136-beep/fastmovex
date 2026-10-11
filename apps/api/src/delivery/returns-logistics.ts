import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Optional, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma, ReturnCondition } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { tzFor } from '../analytics/range';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions, Roles } from '../common/decorators/auth.decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderChangesService } from '../orders/order-changes';
import { OrdersModule } from '../orders/orders.module';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';
import { mapLink } from './delivery-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Qatar calendar day of a date (YYYY-MM-DD). Exported for tests. */
export function localDay(d: Date, offsetMin: number): string {
  return new Date(d.getTime() + offsetMin * 60_000).toISOString().slice(0, 10);
}

/**
 * Goods coming back to us:
 *  - items the customer refused at the door (the driver brings them back; the warehouse books them in),
 *  - approved returns collected from the customer by a driver (then checked as usual on the Returns page).
 */
@Injectable()
export class ReturnsLogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly changes: OrderChangesService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ refused at the door

  /**
   * The customer takes only part of the shipment. Before entering the code, the driver records what was refused:
   * the order, the cash to collect (or a refund for card payments) and the stock follow.
   */
  async refuseItems(deliveryId: string, courierId: string, items: { itemId: string; quantity: number }[], reason: string) {
    const d = await this.prisma.deliveryOrder.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, courierUserId: true, sellerOrder: { select: { order: { select: { orderNumber: true } }, items: { where: { status: { not: 'CANCELLED' } }, select: { id: true, quantity: true } } } } },
    });
    if (!d || d.courierUserId !== courierId) throw new NotFoundException('Job not found');
    if (d.status !== 'OUT_FOR_DELIVERY') throw new BadRequestException('Refused items are recorded at the door, while out for delivery');
    const qty = new Map(d.sellerOrder.items.map((i) => [i.id, i.quantity]));
    const changes = items.map((x) => {
      const have = qty.get(x.itemId);
      if (have === undefined) throw new NotFoundException('Item not found in this delivery');
      if (x.quantity < 1 || x.quantity > have) throw new BadRequestException(`Refused quantity must be between 1 and ${have}`);
      return { itemId: x.itemId, quantity: have - x.quantity };
    });
    return this.changes.changeItems(d.sellerOrder.order.orderNumber, changes, reason, { id: courierId, role: 'DRIVER' }, { deliveryOrderId: d.id });
  }

  async doorReturns(open: boolean) {
    const rows = await this.prisma.doorReturn.findMany({
      where: open ? { receivedAt: null } : { receivedAt: { not: null } },
      orderBy: { createdAt: open ? 'asc' : 'desc' }, take: 200,
      select: {
        id: true, quantity: true, reason: true, createdAt: true, receivedAt: true, condition: true, note: true, courierUserId: true, receivedById: true,
        orderItem: { select: { productTitle: true, sku: true, order: { select: { orderNumber: true } } } },
      },
    });
    const ids = [...new Set(rows.flatMap((r) => [r.courierUserId, r.receivedById]).filter((x): x is string => !!x))];
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return rows.map(({ courierUserId, receivedById, ...r }) => ({ ...r, driver: courierUserId ? names.get(courierUserId) ?? null : null, receivedBy: receivedById ? names.get(receivedById) ?? null : null }));
  }

  /** The units are back at the warehouse: sellable → on the shelf they left from; damaged → kept off stock, recorded. */
  async receiveDoorReturn(id: string, condition: 'SELLABLE' | 'DAMAGED', note: string | undefined, actorId: string) {
    const clean = note?.trim() || null;
    if (condition === 'DAMAGED' && (!clean || clean.length < 5)) throw new BadRequestException('Describe the damage (at least 5 characters)');
    const r = await this.prisma.$transaction(async (tx) => {
      const done = await tx.doorReturn.updateMany({ where: { id, receivedAt: null }, data: { receivedAt: new Date(), receivedById: actorId, condition: condition as ReturnCondition, note: clean } });
      if (done.count !== 1) {
        const exists = await tx.doorReturn.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Not found');
        throw new ConflictException('Already booked in');
      }
      const dr = await tx.doorReturn.findUniqueOrThrow({
        where: { id },
        select: { quantity: true, orderItem: { select: { id: true, variantId: true, sku: true, sellerOrder: { select: { sellerId: true, warehouseId: true } } } } },
      });
      const warehouseId = dr.orderItem.sellerOrder.warehouseId ?? (await this.warehouses.defaultFor(tx, dr.orderItem.sellerOrder.sellerId));
      if (condition === 'SELLABLE') {
        await this.warehouses.move(tx, { warehouseId, variantId: dr.orderItem.variantId, delta: dr.quantity, reason: 'RETURN', refType: 'door_return', refId: id, actorId, label: dr.orderItem.sku, note: 'Refused at the door' });
      } else {
        await tx.inventoryMovement.create({ data: { variantId: dr.orderItem.variantId, warehouseId, qtyDelta: 0, reason: 'RETURN', refType: 'door_return', refId: id, actorId, note: `Refused at the door, damaged x${dr.quantity}: ${clean}`.slice(0, 300) } });
      }
      return dr;
    });
    await this.audit.log({ actorId, action: 'door_return.received', entityType: 'DoorReturn', entityId: id, after: { condition, quantity: r.quantity, note: clean } });
    return { id, condition };
  }

  // ------------------------------------------------------------------ return pickups

  /** A driver will collect an approved return on a given day. A pickup that failed or was cancelled can be arranged again. */
  async schedulePickup(returnId: string, input: { courierUserId: string; date: string; note?: string }, actorId: string, now = new Date()) {
    const ret = await this.prisma.returnRequest.findUnique({
      where: { id: returnId },
      select: {
        id: true, status: true, quantity: true, userId: true, pickup: { select: { id: true, status: true } },
        orderItem: { select: { productTitle: true, order: { select: { orderNumber: true, countryCode: true, shippingAddress: true } } } },
      },
    });
    if (!ret) throw new NotFoundException('Return not found');
    if (ret.status !== 'APPROVED') throw new ConflictException('Only an approved return waiting for the item can be collected');
    if (ret.pickup && ['ASSIGNED', 'COLLECTED'].includes(ret.pickup.status)) throw new ConflictException('A pickup is already arranged for this return');
    const driver = await this.prisma.user.findFirst({ where: { id: input.courierUserId, status: 'ACTIVE', roles: { some: { role: { code: 'DELIVERY_AGENT' } } } }, select: { id: true, fullName: true } });
    if (!driver) throw new BadRequestException('Choose an active driver');
    const today = localDay(now, tzFor(ret.orderItem.order.countryCode).offsetMin);
    if (input.date < today) throw new BadRequestException('The pickup day cannot be in the past');
    const address = (ret.orderItem.order.shippingAddress ?? {}) as Prisma.InputJsonValue;
    const data = { status: 'ASSIGNED' as const, courierUserId: driver.id, date: new Date(`${input.date}T00:00:00Z`), address, note: input.note?.trim() || null, createdById: actorId, collectedAt: null, collectedLat: null, collectedLng: null, failedAt: null, failureReason: null };
    const p = ret.pickup
      ? await this.prisma.returnPickup.update({ where: { id: ret.pickup.id }, data, select: { id: true } })
      : await this.prisma.returnPickup.create({ data: { ...data, returnRequestId: ret.id }, select: { id: true } });
    await this.audit.log({ actorId, action: 'return.pickup_scheduled', entityType: 'ReturnRequest', entityId: ret.id, after: { pickupId: p.id, driver: driver.fullName, date: input.date } });
    const u = await this.prisma.user.findUnique({ where: { id: ret.userId }, select: { locale: true } });
    const ar = u?.locale === 'ar';
    const date = new Intl.DateTimeFormat(ar ? 'ar-QA' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${input.date}T00:00:00Z`));
    await this.notifications?.notify(ret.userId, 'RETURN_PICKUP_SCHEDULED', { product: ret.orderItem.productTitle, date }, { orderNumber: ret.orderItem.order.orderNumber }).catch(() => undefined);
    return { id: p.id, status: 'ASSIGNED', date: input.date, driver: driver.fullName };
  }

  async cancelPickup(returnId: string, actorId: string) {
    const done = await this.prisma.returnPickup.updateMany({ where: { returnRequestId: returnId, status: { in: ['ASSIGNED', 'FAILED'] } }, data: { status: 'CANCELLED' } });
    if (!done.count) throw new ConflictException('No open pickup for this return');
    await this.audit.log({ actorId, action: 'return.pickup_cancelled', entityType: 'ReturnRequest', entityId: returnId });
    return { ok: true };
  }

  /** The driver's pickups: open ones (any day up to today, in date order) and today's finished ones. */
  async courierPickups(courierId: string, now = new Date()) {
    const today = new Date(`${localDay(now, tzFor(process.env.DEFAULT_COUNTRY ?? 'QA').offsetMin)}T00:00:00Z`);
    const rows = await this.prisma.returnPickup.findMany({
      where: { courierUserId: courierId, OR: [{ status: 'ASSIGNED', date: { lte: today } }, { status: { in: ['COLLECTED', 'FAILED'] }, updatedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } }] },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], take: 100,
      select: {
        id: true, status: true, date: true, address: true, note: true, collectedAt: true, failureReason: true,
        returnRequest: { select: { quantity: true, reason: true, orderItem: { select: { productTitle: true, sku: true, order: { select: { orderNumber: true } } } } } },
      },
    });
    return rows.map((p) => {
      const a = (p.address ?? {}) as Record<string, string | number | null | undefined>;
      const str = (k: string) => (typeof a[k] === 'string' && a[k] ? String(a[k]) : null);
      const address = { zone: str('zone'), street: str('street'), building: str('building'), unit: str('unit'), city: str('city'), line1: str('line1'), lat: typeof a.lat === 'number' ? a.lat : null, lng: typeof a.lng === 'number' ? a.lng : null };
      return {
        id: p.id, status: p.status, date: p.date.toISOString().slice(0, 10), note: p.note, collectedAt: p.collectedAt, failureReason: p.failureReason,
        orderNumber: p.returnRequest.orderItem.order.orderNumber, item: { title: p.returnRequest.orderItem.productTitle, sku: p.returnRequest.orderItem.sku, quantity: p.returnRequest.quantity },
        reason: p.returnRequest.reason, customer: { name: str('recipientName'), phone: str('phone') }, address: { ...address, mapUrl: mapLink(address) },
      };
    });
  }

  private async myPickup(id: string, courierId: string) {
    const p = await this.prisma.returnPickup.findUnique({ where: { id }, select: { id: true, status: true, courierUserId: true, returnRequestId: true } });
    if (!p || p.courierUserId !== courierId) throw new NotFoundException('Pickup not found');
    if (p.status !== 'ASSIGNED') throw new ConflictException(`This pickup is already ${p.status.toLowerCase()}`);
    return p;
  }

  async collected(id: string, courierId: string, at?: { lat?: number; lng?: number }) {
    const p = await this.myPickup(id, courierId);
    await this.prisma.returnPickup.update({ where: { id }, data: { status: 'COLLECTED', collectedAt: new Date(), collectedLat: at?.lat ?? null, collectedLng: at?.lng ?? null } });
    await this.audit.log({ actorId: courierId, action: 'return.pickup_collected', entityType: 'ReturnRequest', entityId: p.returnRequestId });
    return { id, status: 'COLLECTED' };
  }

  async pickupFailed(id: string, courierId: string, reason: string) {
    const p = await this.myPickup(id, courierId);
    await this.prisma.returnPickup.update({ where: { id }, data: { status: 'FAILED', failedAt: new Date(), failureReason: reason } });
    await this.audit.log({ actorId: courierId, action: 'return.pickup_failed', entityType: 'ReturnRequest', entityId: p.returnRequestId, after: { reason } });
    return { id, status: 'FAILED' };
  }
}

// ====================================================================== HTTP

class RefusedItemDto {
  @ApiProperty() @IsUUID() itemId: string;
  @ApiProperty({ minimum: 1, description: 'How many the customer refused' }) @Type(() => Number) @IsInt() @Min(1) quantity: number;
}
class RefuseItemsDto {
  @ApiProperty({ type: [RefusedItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RefusedItemDto) items: RefusedItemDto[];
  @ApiProperty({ example: 'Wrong colour' }) @Transform(trim) @IsString() @Length(3, 300) reason: string;
}
class PickupDoneDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}
class PickupFailDto { @ApiProperty({ example: 'Customer not at home' }) @Transform(trim) @IsString() @Length(3, 300) reason: string; }
class SchedulePickupDto {
  @ApiProperty() @IsUUID() courierUserId: string;
  @ApiProperty({ example: '2026-10-09' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class ReceiveDoorReturnDto {
  @ApiProperty({ enum: ['SELLABLE', 'DAMAGED'] }) @IsIn(['SELLABLE', 'DAMAGED']) condition: 'SELLABLE' | 'DAMAGED';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}
class DoorReturnsQuery {
  @ApiPropertyOptional({ default: true }) @IsOptional() @Transform(({ value }) => value !== 'false' && value !== false) @IsBoolean() open?: boolean;
}

@ApiTags('Courier') @ApiBearerAuth() @Roles('DELIVERY_AGENT')
@Controller({ path: 'courier', version: '1' })
export class CourierReturnsController {
  constructor(private readonly svc: ReturnsLogisticsService) {}

  /** At the door: the customer refuses part of the shipment. Record it before entering the code. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @HttpCode(200) @Post('jobs/:id/refuse-items')
  refuse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: RefuseItemsDto) { return this.svc.refuseItems(id, u.id, d.items, d.reason); }

  @Get('pickups') pickups(@CurrentUser() u: AuthUser) { return this.svc.courierPickups(u.id); }
  @HttpCode(200) @Post('pickups/:id/collected') collected(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PickupDoneDto) { return this.svc.collected(id, u.id, d); }
  @HttpCode(200) @Post('pickups/:id/failed') failed(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PickupFailDto) { return this.svc.pickupFailed(id, u.id, d.reason); }
}

@ApiTags('Admin / Returns') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminReturnsLogisticsController {
  constructor(private readonly svc: ReturnsLogisticsService) {}

  @RequirePermissions('returns.manage') @Post('returns/:id/pickup')
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body() d: SchedulePickupDto, @CurrentUser() u: AuthUser) { return this.svc.schedulePickup(id, d, u.id); }
  @RequirePermissions('returns.manage') @HttpCode(200) @Delete('returns/:id/pickup')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.cancelPickup(id, u.id); }

  /** Units refused at the door: still with the driver (open) or booked back in. */
  @RequirePermissions('returns.manage') @Get('door-returns') list(@Query() q: DoorReturnsQuery) { return this.svc.doorReturns(q.open ?? true); }
  @RequirePermissions('returns.manage') @HttpCode(200) @Post('door-returns/:id/receive')
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() d: ReceiveDoorReturnDto, @CurrentUser() u: AuthUser) { return this.svc.receiveDoorReturn(id, d.condition, d.note, u.id); }
}

@Module({ imports: [OrdersModule], controllers: [CourierReturnsController, AdminReturnsLogisticsController], providers: [ReturnsLogisticsService] })
export class ReturnsLogisticsModule {}
