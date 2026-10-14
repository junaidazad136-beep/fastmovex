import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Optional, Param, ParseIntPipe,
  ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, ReviewStatus, ReviewTarget } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOAD_LIMITS, validateUpload } from '../storage/file-validation';
import { cleanPhoto } from '../storage/photo';
import { StorageService } from '../storage/storage.service';
import { StorefrontService } from '../common/storefront.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MAX_IMAGES = 5;
/** Photos shown above the reviews ("Customer photos"). */
const GALLERY = 12;
const HAS_PHOTOS: Prisma.ReviewWhereInput = { NOT: { images: { equals: [] } } };
const keys = (images: unknown) => (Array.isArray(images) ? (images as string[]) : []);

class CreateReviewDto {
  @ApiProperty() @IsUUID() orderItemId: string;
  @ApiProperty({ enum: ReviewTarget }) @IsEnum(ReviewTarget) target: ReviewTarget;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 2000) body?: string;
}
class ReviewsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional({ description: 'Only reviews with photos' }) @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() withPhotos?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class AdminReviewsQuery {
  @ApiPropertyOptional({ enum: ReviewStatus }) @IsOptional() @IsEnum(ReviewStatus) status?: ReviewStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class ModerateDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) status: 'APPROVED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** "Junaid Azad" -> "Junaid A." — reviews never expose a full name. Exported for tests. */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

/** Rating-only reviews publish instantly; text and photos wait for moderation. Exported for tests. */
export function initialStatus(body?: string | null, hasImages = false): ReviewStatus {
  return body || hasImages ? 'PENDING' : 'APPROVED';
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  /** The website shows reviews from a short cache: refresh the product page right after a change. */
  private async refreshProduct(productId: string | null) {
    if (!productId || !this.storefront) return;
    const p = await this.prisma.product.findUnique({ where: { id: productId }, select: { slug: true } });
    if (p) this.storefront.refresh(`product:${p.slug}`);
  }

  /** Verified purchase only: the item must be in the caller's own order and delivered. One review per item per target. */
  async create(userId: string, dto: CreateReviewDto) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: dto.orderItemId, order: { userId } },
      select: { id: true, status: true, sellerOrder: { select: { sellerId: true, deliveredAt: true } }, variant: { select: { productId: true } } },
    });
    if (!item) throw new NotFoundException('Item not found in your orders');
    if (!item.sellerOrder.deliveredAt) throw new BadRequestException('You can review after the item is delivered');

    try {
      const review = await this.prisma.review.create({
        data: {
          userId, orderItemId: item.id, target: dto.target, rating: dto.rating, body: dto.body,
          productId: dto.target === 'PRODUCT' ? item.variant.productId : null,
          sellerId: dto.target === 'SELLER' ? item.sellerOrder.sellerId : null,
          isVerifiedPurchase: true, status: initialStatus(dto.body),
        },
      });
      if (review.status === 'APPROVED') {
        await this.recompute(review.productId, review.sellerId);
        await this.refreshProduct(review.productId);
      }
      return review;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You already reviewed this');
      throw e;
    }
  }

  async addImage(userId: string, reviewId: string, file: Express.Multer.File | undefined) {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, userId }, select: { id: true, images: true, status: true, productId: true, sellerId: true } });
    if (!review) throw new NotFoundException('Review not found');
    const images = keys(review.images);
    if (images.length >= MAX_IMAGES) throw new BadRequestException(`Up to ${MAX_IMAGES} photos per review`);
    const photo = await cleanPhoto(validateUpload(file, 'image').buffer); // upright, smaller, no GPS/metadata
    const key = `reviews/${reviewId}/${randomUUID()}.${photo.ext}`;
    await this.storage.put('public', key, photo.buffer, photo.mime);
    // photos are moderated; the condition keeps two uploads at once from overwriting each other
    const saved = await this.prisma.review.updateMany({ where: { id: reviewId, images: { equals: images } }, data: { images: [...images, key], status: 'PENDING' } });
    if (saved.count !== 1) {
      await this.storage.delete('public', key).catch(() => undefined);
      throw new ConflictException('Another photo is being added. Please try again.');
    }
    if (review.status === 'APPROVED') await this.recompute(review.productId, review.sellerId);
    return { url: this.storage.publicUrl(key), status: 'PENDING', images: [...images, key].map((k) => this.storage.publicUrl(k)) };
  }

  /** The customer takes a photo back off their review (the review itself stays). */
  async removeImage(userId: string, reviewId: string, index: number) {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, userId }, select: { id: true } });
    if (!review) throw new NotFoundException('Review not found');
    return this.dropImage(reviewId, index);
  }

  /** Staff remove one photo (e.g. a face or an address label) and can then publish the rest of the review. */
  async adminRemoveImage(reviewId: string, index: number, adminId: string) {
    const r = await this.dropImage(reviewId, index);
    await this.audit.log({ actorId: adminId, action: 'review.photo_removed', entityType: 'Review', entityId: reviewId, after: { index } });
    return r;
  }

  private async dropImage(reviewId: string, index: number) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId }, select: { images: true, status: true, productId: true } });
    if (!review) throw new NotFoundException('Review not found');
    const images = keys(review.images);
    if (index < 0 || index >= images.length) throw new NotFoundException('Photo not found');
    const left = images.filter((_, i) => i !== index);
    // only if nobody changed the photos meanwhile
    const res = await this.prisma.review.updateMany({ where: { id: reviewId, images: { equals: images } }, data: { images: left } });
    if (res.count !== 1) throw new ConflictException('The photos just changed. Refresh and try again.');
    await this.storage.delete('public', images[index]).catch(() => undefined);
    if (review.status === 'APPROVED') await this.refreshProduct(review.productId);
    return { images: left.map((k) => this.storage.publicUrl(k)) };
  }

  async forProduct(slug: string, q: ReviewsQuery) {
    const product = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true, ratingAvg: true, ratingCount: true } });
    if (!product) throw new NotFoundException('Product not found');
    return this.page({ productId: product.id, target: 'PRODUCT' }, q, { ratingAvg: product.ratingAvg, ratingCount: product.ratingCount });
  }

  async forStore(slug: string, q: ReviewsQuery) {
    const store = await this.prisma.store.findFirst({ where: { slug, isActive: true }, select: { sellerId: true, ratingAvg: true, ratingCount: true } });
    if (!store) throw new NotFoundException('Store not found');
    return this.page({ sellerId: store.sellerId, target: 'SELLER' }, q, { ratingAvg: store.ratingAvg, ratingCount: store.ratingCount });
  }

  private async page(where: Prisma.ReviewWhereInput, q: ReviewsQuery, summary: { ratingAvg: number; ratingCount: number }) {
    const base = { ...where, status: 'APPROVED' as const };
    const first = !q.cursor;
    const [rows, histogram, gallery, photoReviews] = await Promise.all([
      this.prisma.review.findMany({
        where: { ...base, rating: q.rating, ...(q.withPhotos && HAS_PHOTOS), ...afterCursor(decodeCursor(q.cursor)) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
        select: { id: true, rating: true, body: true, images: true, isVerifiedPurchase: true, createdAt: true, user: { select: { fullName: true } } },
      }),
      first ? this.prisma.review.groupBy({ by: ['rating'], where: base, _count: true }) : Promise.resolve(null),
      first ? this.prisma.review.findMany({ where: { ...base, ...HAS_PHOTOS }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: GALLERY, select: { id: true, rating: true, images: true } }) : Promise.resolve(null),
      first ? this.prisma.review.count({ where: { ...base, ...HAS_PHOTOS } }) : Promise.resolve(null),
    ]);
    const p = toPage(rows, 20);
    return {
      summary: { ratingAvg: Math.round(summary.ratingAvg * 10) / 10, ratingCount: summary.ratingCount, ...(photoReviews !== null && { photoReviews }) },
      ...(gallery && { photos: gallery.flatMap((r) => keys(r.images).map((k) => ({ url: this.storage.publicUrl(k)!, reviewId: r.id, rating: r.rating }))).slice(0, GALLERY) }),
      histogram: histogram ? [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: histogram.find((h) => h.rating === r)?._count ?? 0 })) : undefined,
      nextCursor: p.nextCursor,
      items: p.items.map(({ user, images, ...r }) => ({ ...r, author: displayName(user.fullName), images: ((images as string[]) ?? []).map((k) => this.storage.publicUrl(k)) })),
    };
  }

  async mine(userId: string) {
    const rows = await this.prisma.review.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, include: { product: { select: { slug: true, title: true } } } });
    return rows.map((r) => ({ ...r, images: keys(r.images).map((k) => this.storage.publicUrl(k)) }));
  }

  /** Delivered items the customer has not reviewed yet — powers the "Rate your purchase" screen. */
  async reviewable(userId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { userId }, sellerOrder: { deliveredAt: { not: null } }, reviews: { none: { target: 'PRODUCT' } } },
      orderBy: { sellerOrder: { deliveredAt: 'desc' } },
      take: 50,
      select: { id: true, productTitle: true, imageKey: true, order: { select: { orderNumber: true } } },
    });
    return items.map((i) => ({ orderItemId: i.id, title: i.productTitle, imageUrl: this.storage.publicUrl(i.imageKey), orderNumber: i.order.orderNumber }));
  }

  /** The store's published reviews (products and the store itself), newest first; the first page also has the summary. */
  async forSeller(seller: SellerContext, q: ReviewsQuery = {}) {
    const mine: Prisma.ReviewWhereInput = { status: 'APPROVED', OR: [{ sellerId: seller.id }, { product: { store: { sellerId: seller.id } } }] };
    const rows = await this.prisma.review.findMany({
      where: { ...mine, ...(q.rating && { rating: q.rating }), ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: { id: true, target: true, rating: true, body: true, createdAt: true, images: true, product: { select: { title: true, titleAr: true, slug: true } }, user: { select: { fullName: true } } },
    });
    const p = toPage(rows, 25);
    let summary: { count: number; average: number; byStar: number[] } | undefined;
    if (!q.cursor) {
      const groups = await this.prisma.review.groupBy({ by: ['rating'], where: mine, _count: { _all: true } });
      const byStar = [1, 2, 3, 4, 5].map((n) => groups.find((g) => g.rating === n)?._count._all ?? 0);
      const count = byStar.reduce((a, b) => a + b, 0);
      summary = { count, average: count ? Math.round((byStar.reduce((a, n, i) => a + n * (i + 1), 0) / count) * 10) / 10 : 0, byStar };
    }
    return {
      ...(summary && { summary }),
      nextCursor: p.nextCursor,
      items: p.items.map(({ user, images, ...r }) => ({ ...r, author: displayName(user.fullName), images: ((images as string[]) ?? []).map((k) => this.storage.publicUrl(k)) })),
    };
  }

  async adminList(q: AdminReviewsQuery) {
    const rows = await this.prisma.review.findMany({
      where: { status: q.status ?? 'PENDING', ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      include: { user: { select: { id: true, fullName: true } }, product: { select: { title: true, slug: true } } },
    });
    const p = toPage(rows, 25);
    return { nextCursor: p.nextCursor, items: p.items.map((r) => ({ ...r, images: ((r.images as string[]) ?? []).map((k) => this.storage.publicUrl(k)) })) };
  }

  async moderate(id: string, dto: ModerateDto, adminId: string) {
    const r = await this.prisma.review.findUnique({ where: { id }, select: { status: true, productId: true, sellerId: true } });
    if (!r) throw new NotFoundException('Review not found');
    await this.prisma.review.update({ where: { id }, data: { status: dto.status, moderatedById: adminId } });
    await this.recompute(r.productId, r.sellerId);
    await this.refreshProduct(r.productId);
    await this.audit.log({ actorId: adminId, action: `review.${dto.status.toLowerCase()}`, entityType: 'Review', entityId: id, before: { status: r.status }, after: { note: dto.note ?? null } });
    return { id, status: dto.status };
  }

  /** Ratings are always recalculated from approved reviews — never incremented, so they cannot drift. */
  async recompute(productId: string | null, sellerId: string | null) {
    if (productId) {
      const a = await this.prisma.review.aggregate({ where: { productId, target: 'PRODUCT', status: 'APPROVED' }, _avg: { rating: true }, _count: true });
      await this.prisma.product.update({ where: { id: productId }, data: { ratingAvg: a._avg.rating ?? 0, ratingCount: a._count } });
    }
    if (sellerId) {
      const a = await this.prisma.review.aggregate({ where: { sellerId, target: 'SELLER', status: 'APPROVED' }, _avg: { rating: true }, _count: true });
      await this.prisma.store.updateMany({ where: { sellerId }, data: { ratingAvg: a._avg.rating ?? 0, ratingCount: a._count } });
    }
  }
}

@ApiTags('Reviews')
@Controller({ version: '1' })
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Public() @Get('products/:slug/reviews') product(@Param('slug') slug: string, @Query() q: ReviewsQuery) { return this.svc.forProduct(slug, q); }
  @Public() @Get('stores/:slug/reviews') store(@Param('slug') slug: string, @Query() q: ReviewsQuery) { return this.svc.forStore(slug, q); }

  @ApiBearerAuth() @Post('reviews') create(@CurrentUser() u: AuthUser, @Body() dto: CreateReviewDto) { return this.svc.create(u.id, dto); }
  @ApiBearerAuth() @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Post('reviews/:id/images')
  image(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) { return this.svc.addImage(u.id, id, file); }
  @ApiBearerAuth() @Delete('reviews/:id/images/:index')
  removeImage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) { return this.svc.removeImage(u.id, id, index); }
  @ApiBearerAuth() @Get('me/reviews') mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.id); }
  @ApiBearerAuth() @Get('me/reviewable') reviewable(@CurrentUser() u: AuthUser) { return this.svc.reviewable(u.id); }
}

@ApiTags('Seller / Reviews') @ApiBearerAuth() @UseGuards(SellerGuard)
@Controller({ path: 'seller/reviews', version: '1' })
export class SellerReviewsController {
  constructor(private readonly svc: ReviewsService) {}
  @Get() list(@CurrentSeller() s: SellerContext, @Query() q: ReviewsQuery) { return this.svc.forSeller(s, q); }
}

@ApiTags('Admin / Reviews') @ApiBearerAuth() @RequirePermissions('reviews.moderate')
@Controller({ path: 'admin/reviews', version: '1' })
export class AdminReviewsController {
  constructor(private readonly svc: ReviewsService) {}
  @Get() list(@Query() q: AdminReviewsQuery) { return this.svc.adminList(q); }
  @HttpCode(200) @Post(':id/moderate') moderate(@Param('id', ParseUUIDPipe) id: string, @Body() d: ModerateDto, @CurrentUser() u: AuthUser) { return this.svc.moderate(id, d, u.id); }
  @HttpCode(200) @Post(':id/images/:index/remove')
  removeImage(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number, @CurrentUser() u: AuthUser) { return this.svc.adminRemoveImage(id, index, u.id); }
}

@Module({ controllers: [ReviewsController, SellerReviewsController, AdminReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
