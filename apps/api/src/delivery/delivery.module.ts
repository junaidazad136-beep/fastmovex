import { Body, Controller, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Res, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { OrderAccessService } from '../common/order-access.service';
import { SlotsModule } from './slots.module';
import { Response } from 'express';
import { CashModule, sendPdf } from '../cash/cash';
import { PrismaService } from '../prisma/prisma.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { DeliveryStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions, Roles } from '../common/decorators/auth.decorators';
import { OrdersModule } from '../orders/orders.module';
import { UPLOAD_LIMITS } from '../storage/file-validation';
import { DeliveryService } from './delivery.service';

class AssignDto { @ApiProperty() @IsUUID() courierUserId: string; }
class LocationDto {
  @ApiProperty() @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty() @Type(() => Number) @IsLongitude() lng: number;
}
class DeliverDto {
  @ApiProperty({ example: '4821' }) @Matches(/^\d{4}$/) code: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) recipientName?: string;
}
class FailDto {
  @ApiProperty({ example: 'Customer not answering' }) @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(3, 300) reason: string;
  @ApiPropertyOptional({ description: 'The customer refused the order at the door (counts towards switching cash on delivery off for them)' })
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() refused?: boolean;
  @ApiPropertyOptional({ description: 'Where the driver is (from the phone)' }) @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}
class RescheduleDto {
  @ApiPropertyOptional({ example: '2026-10-06T10:00:00.000Z', description: 'Start of a window from GET /delivery/slots' }) @IsOptional() @IsISO8601({ strict: true }) deliverySlot?: string;
  @ApiPropertyOptional({ example: 'After 5 pm, call first' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(300) note?: string;
}
class RunSheetQuery { @ApiProperty() @IsUUID() courierUserId: string; }
class ListQuery {
  @ApiPropertyOptional({ enum: DeliveryStatus }) @IsOptional() @IsEnum(DeliveryStatus) status?: DeliveryStatus;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unassigned?: boolean;
}

@ApiTags('Orders') @ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class TrackingController {
  constructor(private readonly delivery: DeliveryService) {}
  @Get(':orderNumber/tracking') track(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string) { return this.delivery.tracking(u.id, n); }
  /** After a missed delivery: a new window and/or a note for the driver. */
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(200) @Post(':orderNumber/reschedule')
  reschedule(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Body() d: RescheduleDto) { return this.delivery.reschedule(n, { userId: u.id }, d); }
}

@ApiTags('Orders')
@Controller({ path: 'orders/guest', version: '1' })
export class GuestRescheduleController {
  constructor(private readonly delivery: DeliveryService, private readonly access: OrderAccessService, private readonly prisma: PrismaService) {}
  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @HttpCode(200) @Post(':orderNumber/reschedule')
  async reschedule(@Param('orderNumber') n: string, @Body() d: RescheduleDto, @Headers('x-order-token') token?: string) {
    const o = await this.prisma.order.findUnique({ where: { orderNumber: n.toUpperCase() }, select: { id: true } });
    if (!o || !this.access.verify(o.id, token)) throw new UnauthorizedException('This link has expired or is not valid.');
    return this.delivery.reschedule(n.toUpperCase(), { guestOrderId: o.id }, d);
  }
}

/** Courier app. Only users with the DELIVERY_AGENT role, and only their own jobs. */
@ApiTags('Courier') @ApiBearerAuth() @Roles('DELIVERY_AGENT')
@Controller({ path: 'courier/jobs', version: '1' })
export class CourierController {
  constructor(private readonly delivery: DeliveryService, private readonly prisma: PrismaService) {}

  @Get() jobs(@CurrentUser() u: AuthUser) { return this.delivery.courierJobs(u.id); }
  /** Today's run for the driver page: open jobs in driving order plus today's finished ones, with a summary. */
  @Get('run') run(@CurrentUser() u: AuthUser) { return this.delivery.courierRun(u.id); }
  @HttpCode(200) @Post(':id/pickup') pickup(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.delivery.pickup(id, u.id); }
  @HttpCode(200) @Post(':id/out-for-delivery') out(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.delivery.outForDelivery(id, u.id); }
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/location') location(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: LocationDto) { return this.delivery.location(id, u.id, d.lat, d.lng); }
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/deliver')
  deliver(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: DeliverDto, @UploadedFile() photo?: Express.Multer.File) {
    return this.delivery.deliver(id, u.id, d.code, d.recipientName, photo);
  }
  /** A failed attempt, with the phone's location and an optional photo of the door (multipart) as proof. */
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200) @Post(':id/fail')
  fail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: FailDto, @UploadedFile() photo?: Express.Multer.File) {
    return this.delivery.fail(id, u.id, d.reason, !!d.refused, { lat: d.lat, lng: d.lng, photo });
  }
  /** Today's run as a PDF to print or keep on the phone. */
  @Get('run.pdf')
  async runPdf(@CurrentUser() u: AuthUser, @Res() res: Response) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { fullName: true } });
    sendPdf(res, await this.delivery.runSheet(u.id, user.fullName), `run-sheet-${new Date().toISOString().slice(0, 10)}.pdf`);
  }
}

@ApiTags('Admin / Delivery') @ApiBearerAuth()
@Controller({ path: 'admin/deliveries', version: '1' })
export class AdminDeliveryController {
  constructor(private readonly delivery: DeliveryService, private readonly prisma: PrismaService) {}
  /** Print a driver's run sheet (stops, items, cash to collect, signature boxes). */
  @RequirePermissions('delivery.read') @Get('run-sheet.pdf')
  async runSheet(@Query() q: RunSheetQuery, @CurrentUser() u: AuthUser, @Res() res: Response) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { fullName: true } });
    sendPdf(res, await this.delivery.runSheet(q.courierUserId, user.fullName), `run-sheet-${new Date().toISOString().slice(0, 10)}.pdf`);
  }
  @RequirePermissions('delivery.read') @Get() list(@Query() q: ListQuery) { return this.delivery.list(q.status, q.unassigned); }
  @RequirePermissions('delivery.read') @Get('couriers') couriers() { return this.delivery.couriers(); }
  @RequirePermissions('delivery.manage') @HttpCode(200) @Post(':id/assign') assign(@Param('id', ParseUUIDPipe) id: string, @Body() d: AssignDto, @CurrentUser() u: AuthUser) { return this.delivery.assign(id, d.courierUserId, u.id); }
  @RequirePermissions('delivery.read') @Get(':id/failure-photo') failurePhoto(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.delivery.failurePhotoUrl(id, u.id); }
  @RequirePermissions('delivery.read') @Get(':id/proof') proof(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.delivery.proofUrl(id, u.id); }
}

@Module({ imports: [OrdersModule, CashModule, SlotsModule], controllers: [TrackingController, GuestRescheduleController, CourierController, AdminDeliveryController], providers: [DeliveryService] })
export class DeliveryModule {}
