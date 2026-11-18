import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Optional, Param,
  ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FileInterceptor } from '@nestjs/platform-express';
import { Cron } from '@nestjs/schedule';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WarrantyResolution, WarrantyStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { EVENTS } from '../notifications/notification.events';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOAD_LIMITS, validateUpload } from '../storage/file-validation';
import { cleanPhoto } from '../storage/photo';
import { StorageService } from '../storage/storage.service';

/** Policy: faulty within 7 days of delivery = a normal return; after that, during the warranty = a warranty claim. */
export const RETURN_INSTEAD_DAYS = 7;
/** Policy: repaired (or replaced) within 14 days of accepting the claim. */
export const REPAIR_DAYS = 14;
const MAX_PHOTOS = 5;
const OPEN: WarrantyStatus[] = ['REQUESTED', 'ACCEPTED', 'IN_REPAIR'];

/** Warranty end date: delivery + N months (calendar months, same day). Exported for tests. */
export function warrantyEnds(deliveredAt: Date, months: number): Date {
  const d = new Date(deliveredAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Which claim step may follow which, and who may take it. Exported for tests.
 * REQUESTED -> ACCEPTED | REJECTED (seller or staff); ACCEPTED -> IN_REPAIR (item collected); IN_REPAIR | ACCEPTED -> RESOLVED.
 */
export function nextAllowed(from: WarrantyStatus, to: WarrantyStatus): boolean {
  const map: Record<WarrantyStatus, WarrantyStatus[]> = {
    REQUESTED: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['IN_REPAIR', 'RESOLVED'], IN_REPAIR: ['RESOLVED'], REJECTED: [], RESOLVED: [],
  };
  return map[from].includes(to);
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ClaimDto {
  @ApiProperty() @IsUUID() orderItemId: string;
  @ApiProperty({ example: 'The screen stays black after charging' }) @Transform(trim) @IsString() @Length(10, 1000) description: string;
}
class StepDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED', 'IN_REPAIR', 'RESOLVED'] }) @IsIn(['ACCEPTED', 'REJECTED', 'IN_REPAIR', 'RESOLVED']) status: 'ACCEPTED' | 'REJECTED' | 'IN_REPAIR' | 'RESOLVED';
  @ApiPropertyOptional({ enum: WarrantyResolution, description: 'Required for RESOLVED' }) @IsOptional() @IsEnum(WarrantyResolution) resolution?: WarrantyResolution;
  @ApiPropertyOptional({ description: 'The customer reads it. Required when rejecting.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}
class ListQuery {
  @ApiPropertyOptional({ enum: WarrantyStatus }) @IsOptional() @IsEnum(WarrantyStatus) status?: WarrantyStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

@Injectable()
export class WarrantyService {
  private readonly logger = new Logger(WarrantyService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async claim(userId: string, orderNumber: string, dto: ClaimDto, now = new Date()) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: dto.orderItemId, order: { orderNumber: orderNumber.toUpperCase(), userId } },
      select: {
        id: true, status: true, quantity: true, refundedQty: true,
        sellerOrder: { select: { sellerId: true, deliveredAt: true } },
        variant: { select: { product: { select: { warrantyMonths: true } } } },
        warrantyClaims: { where: { status: { in: OPEN } }, select: { id: true } },
      },
    });
    if (!item) throw new NotFoundException('Item not found in this order');
    const delivered = item.sellerOrder.deliveredAt;
    if (!delivered || !['DELIVERED', 'RETURN_REQUESTED'].includes(item.status) || item.refundedQty >= item.quantity) {
      throw new BadRequestException('A warranty claim is possible for delivered items you still have');
    }
    const months = item.variant.product.warrantyMonths ?? 0;
    if (months <= 0) throw new BadRequestException('This item has no warranty');
    const ends = warrantyEnds(delivered, months);
    if (now > ends) throw new BadRequestException('The warranty for this item has ended');
    if (now.getTime() - delivered.getTime() <= RETURN_INSTEAD_DAYS * 86_400_000) {
      throw new BadRequestException({ message: 'Faulty within 7 days of delivery: request a return instead (choose "Damaged or not working") for a replacement or full refund.', reason: 'USE_RETURN' });
    }
    if (item.warrantyClaims.length) throw new ConflictException('There is already an open warranty claim for this item');
    const c = await this.prisma.warrantyClaim.create({
      data: { orderItemId: item.id, userId, sellerId: item.sellerOrder.sellerId, description: dto.description, warrantyEndsOn: ends },
      select: { id: true, status: true, warrantyEndsOn: true },
    });
    await this.audit.log({ actorId: userId, action: 'warranty.claim', entityType: 'WarrantyClaim', entityId: c.id });
    this.events?.emit(EVENTS.WARRANTY_UPDATED, { id: c.id, status: 'REQUESTED' });
    return { ...c, photosRequired: true };
  }

  async addPhoto(userId: string, id: string, file: Express.Multer.File | undefined) {
    const c = await this.prisma.warrantyClaim.findFirst({ where: { id, userId }, select: { id: true, status: true, images: true } });
    if (!c) throw new NotFoundException('Claim not found');
    if (c.status !== 'REQUESTED') throw new BadRequestException('Photos can only be added while the claim waits for review');
    const images = (c.images as string[]) ?? [];
    if (images.length >= MAX_PHOTOS) throw new BadRequestException(`Up to ${MAX_PHOTOS} photos per claim`);
    const photo = await cleanPhoto(validateUpload(file, 'image').buffer);
    const key = `warranty/${id}/${randomUUID()}.${photo.ext}`;
    await this.storage.put('public', key, photo.buffer, photo.mime);
    const res = await this.prisma.warrantyClaim.updateMany({ where: { id, userId, status: 'REQUESTED', images: { equals: images } }, data: { images: [...images, key] } });
    if (res.count !== 1) throw new ConflictException('Another photo is being added. Please try again.');
    return { photos: images.length + 1 };
  }

  async listForCustomer(userId: string) {
    const rows = await this.prisma.warrantyClaim.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: {
        id: true, status: true, resolution: true, note: true, description: true, warrantyEndsOn: true, dueAt: true, createdAt: true, updatedAt: true, images: true,
        orderItem: { select: { productTitle: true, sku: true, order: { select: { orderNumber: true } } } },
      },
    });
    return rows.map((r) => ({ ...r, images: this.urls(r.images) }));
  }

  /** Seller (own claims only) or staff (sellerId undefined). */
  async list(q: ListQuery, sellerId?: string) {
    const rows = await this.prisma.warrantyClaim.findMany({
      where: { status: q.status, ...(sellerId && { sellerId }), ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 26,
      select: {
        id: true, status: true, resolution: true, note: true, description: true, images: true, warrantyEndsOn: true, acceptedAt: true, dueAt: true, resolvedAt: true, createdAt: true,
        orderItem: { select: { productTitle: true, sku: true, imageKey: true, order: { select: { orderNumber: true } } } },
        ...(!sellerId && { seller: { select: { businessName: true } }, user: { select: { fullName: true, phone: true } } }),
      },
    });
    const page = toPage(rows, 25);
    const now = Date.now();
    return {
      ...page,
      items: page.items.map(({ images, orderItem: { imageKey, ...oi }, ...r }) => ({
        ...r, images: this.urls(images), orderItem: { ...oi, imageUrl: imageKey ? this.storage.publicUrl(imageKey) : null },
        overdue: !!r.dueAt && r.status !== 'RESOLVED' && r.status !== 'REJECTED' && r.dueAt.getTime() < now,
      })),
    };
  }

  async step(id: string, dto: StepDto, actorId: string, sellerId?: string, now = new Date()) {
    const c = await this.prisma.warrantyClaim.findUnique({ where: { id }, select: { id: true, status: true, sellerId: true, images: true } });
    if (!c || (sellerId && c.sellerId !== sellerId)) throw new NotFoundException('Claim not found');
    if (!nextAllowed(c.status, dto.status)) throw new BadRequestException(`A claim that is ${c.status.toLowerCase().replace('_', ' ')} cannot become ${dto.status.toLowerCase().replace('_', ' ')}`);
    if (dto.status === 'REJECTED' && (!dto.note || dto.note.length < 5)) throw new BadRequestException('Tell the customer why (at least 5 characters)');
    if (dto.status === 'ACCEPTED' && !((c.images as string[]) ?? []).length) throw new BadRequestException('Wait for the customer\'s photos before accepting');
    if (dto.status === 'RESOLVED' && !dto.resolution) throw new BadRequestException('Choose what was done: repaired, replaced or refunded');
    const res = await this.prisma.warrantyClaim.updateMany({
      where: { id, status: c.status },
      data: {
        status: dto.status, note: dto.note ?? undefined,
        ...(dto.status === 'ACCEPTED' && { acceptedAt: now, dueAt: new Date(now.getTime() + REPAIR_DAYS * 86_400_000) }),
        ...(dto.status === 'RESOLVED' && { resolution: dto.resolution, resolvedAt: now }),
      },
    });
    if (res.count !== 1) throw new ConflictException('The claim just changed. Refresh and try again.');
    await this.audit.log({ actorId, action: `warranty.${dto.status.toLowerCase()}`, entityType: 'WarrantyClaim', entityId: id, after: { resolution: dto.resolution ?? null, bySeller: !!sellerId } });
    this.events?.emit(EVENTS.WARRANTY_UPDATED, { id, status: dto.status });
    return this.prisma.warrantyClaim.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, resolution: true, note: true, dueAt: true, resolvedAt: true } });
  }

  /** Every hour: accepted claims past the 14 days get one reminder to the seller (and show as overdue to staff). */
  @Cron('40 * * * *', { name: 'warranty-overdue' })
  async remindOverdue(now = new Date()) {
    const late = await this.prisma.warrantyClaim.findMany({ where: { status: { in: ['ACCEPTED', 'IN_REPAIR'] }, dueAt: { lt: now }, overdueWarnedAt: null }, select: { id: true }, take: 200 });
    for (const c of late) {
      const claimed = await this.prisma.warrantyClaim.updateMany({ where: { id: c.id, overdueWarnedAt: null }, data: { overdueWarnedAt: now } });
      if (claimed.count === 1) this.events?.emit(EVENTS.WARRANTY_OVERDUE, { id: c.id });
    }
    return { reminded: late.length };
  }

  private urls(images: unknown) {
    return ((images as string[]) ?? []).map((k) => this.storage.publicUrl(k)).filter(Boolean);
  }
}

@ApiTags('Warranty')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CustomerWarrantyController {
  constructor(private readonly svc: WarrantyService) {}

  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('orders/:orderNumber/warranty')
  claim(@CurrentUser() u: AuthUser, @Param('orderNumber') n: string, @Body() dto: ClaimDto) { return this.svc.claim(u.id, n, dto); }

  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post('me/warranty/:id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  photo(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) { return this.svc.addPhoto(u.id, id, file); }

  @Get('me/warranty') mine(@CurrentUser() u: AuthUser) { return this.svc.listForCustomer(u.id); }
}

@ApiTags('Seller')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@Controller({ path: 'seller', version: '1' })
export class SellerWarrantyController {
  constructor(private readonly svc: WarrantyService) {}
  @Get('warranty') list(@CurrentSeller() s: SellerContext, @Query() q: ListQuery) { return this.svc.list(q, s.id); }
  @HttpCode(200) @Post('warranty/:id/step')
  step(@CurrentSeller() s: SellerContext, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StepDto) { return this.svc.step(id, dto, u.id, s.id); }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminWarrantyController {
  constructor(private readonly svc: WarrantyService) {}
  @RequirePermissions('returns.manage') @Get('warranty') list(@Query() q: ListQuery) { return this.svc.list(q); }
  @RequirePermissions('returns.manage') @HttpCode(200) @Post('warranty/:id/step')
  step(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StepDto) { return this.svc.step(id, dto, u.id); }
}

@Module({ controllers: [CustomerWarrantyController, SellerWarrantyController, AdminWarrantyController], providers: [WarrantyService] })
export class WarrantyModule {}
