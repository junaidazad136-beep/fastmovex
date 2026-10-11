import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Injectable, Logger, Module, NotFoundException,
  Optional, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma, QuestionStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { StorefrontService } from '../common/storefront.service';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { displayName } from '../reviews/reviews';

const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim() : value);

/** Questions a customer may have waiting for an answer (spam guard). */
export const MAX_OPEN_PER_PRODUCT = 3;
export const MAX_OPEN_TOTAL = 10;

class AskDto {
  @ApiProperty({ example: 'Is this suitable for a 2-year-old?' }) @Transform(clean) @IsString() @Length(10, 500) body: string;
}
class AnswerDto {
  @ApiProperty() @Transform(clean) @IsString() @Length(2, 2000) answer: string;
}
class RejectDto {
  @ApiPropertyOptional({ description: 'Kept for staff; the customer sees that it was not published' }) @IsOptional() @Transform(clean) @IsString() @MaxLength(300) reason?: string;
}
class ListQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class AdminListQuery extends ListQuery {
  @ApiPropertyOptional({ enum: QuestionStatus, default: 'PENDING' }) @IsOptional() @IsEnum(QuestionStatus) status?: QuestionStatus;
}

const productCard = { select: { id: true, slug: true, title: true, titleAr: true, store: { select: { name: true, nameAr: true, sellerId: true } }, images: { where: { kind: 'IMAGE' as const }, orderBy: { sortOrder: 'asc' as const }, take: 1, select: { fileKey: true } } } };

/**
 * Product questions: customers ask, the store answers (staff, or the seller for its own products), and only answered
 * questions are public. The customer hears about the answer (in-app, email, WhatsApp if they opted in).
 */
@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly storefront?: StorefrontService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  private async product(slug: string) {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  /** Answered questions, newest first. */
  async forProduct(slug: string, q: ListQuery) {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true, store: { select: { name: true, nameAr: true } } } });
    if (!p) throw new NotFoundException('Product not found');
    const where = { productId: p.id, status: 'ANSWERED' as const };
    const [rows, total] = await Promise.all([
      this.prisma.productQuestion.findMany({
        where: { ...where, ...afterCursor(decodeCursor(q.cursor)) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 11,
        select: { id: true, body: true, answer: true, createdAt: true, answeredAt: true, user: { select: { fullName: true } } },
      }),
      q.cursor ? Promise.resolve(null) : this.prisma.productQuestion.count({ where }),
    ]);
    const page = toPage(rows, 10);
    return {
      ...(total !== null && { total }),
      nextCursor: page.nextCursor,
      items: page.items.map((r) => ({
        id: r.id, question: r.body, answer: r.answer, askedBy: displayName(r.user.fullName), askedAt: r.createdAt, answeredAt: r.answeredAt,
        answeredBy: { name: p.store.name, nameAr: p.store.nameAr },
      })),
    };
  }

  async ask(user: AuthUser, slug: string, dto: AskDto) {
    const p = await this.product(slug);
    const [onProduct, total] = await Promise.all([
      this.prisma.productQuestion.count({ where: { userId: user.id, productId: p.id, status: 'PENDING' } }),
      this.prisma.productQuestion.count({ where: { userId: user.id, status: 'PENDING' } }),
    ]);
    if (onProduct >= MAX_OPEN_PER_PRODUCT || total >= MAX_OPEN_TOTAL) {
      throw new HttpException({ message: 'You have questions waiting for an answer. Please wait for those first.', reason: 'TOO_MANY_OPEN' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { locale: true } });
    const q = await this.prisma.productQuestion.create({ data: { productId: p.id, userId: user.id, body: dto.body, locale: me?.locale === 'ar' ? 'ar' : 'en' } });
    return { id: q.id, status: q.status, createdAt: q.createdAt };
  }

  async mine(userId: string) {
    const rows = await this.prisma.productQuestion.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, body: true, status: true, answer: true, answeredAt: true, createdAt: true, product: { select: { slug: true, title: true, titleAr: true } } },
    });
    return rows.map(({ body, ...r }) => ({ ...r, question: body }));
  }

  // ---------------------------------------------------------------- staff & sellers

  async list(status: QuestionStatus, cursor: string | undefined, sellerId?: string) {
    const where: Prisma.ProductQuestionWhereInput = { status, ...(sellerId && { product: { store: { sellerId } } }) };
    const rows = await this.prisma.productQuestion.findMany({
      where: { ...where, ...afterCursor(decodeCursor(cursor)) },
      // the oldest waiting question first is fairer, but keyset paging is newest-first; staff work the list top-down either way
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: {
        id: true, body: true, locale: true, status: true, answer: true, answeredAt: true, rejectReason: true, createdAt: true,
        user: { select: { fullName: true } }, answeredBy: { select: { fullName: true } }, product: productCard,
      },
    });
    const page = toPage(rows, 25);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ user, answeredBy, product, ...r }) => ({
        ...r, askedBy: displayName(user.fullName), answeredBy: answeredBy?.fullName ?? null,
        product: { id: product.id, slug: product.slug, title: product.title, titleAr: product.titleAr, store: product.store.name, imageUrl: this.storage.publicUrl(product.images[0]?.fileKey ?? null) },
      })),
    };
  }

  async answer(id: string, dto: AnswerDto, actor: AuthUser, sellerId?: string) {
    const q = await this.prisma.productQuestion.findUnique({ where: { id }, select: { id: true, status: true, answer: true, userId: true, locale: true, product: { select: { slug: true, title: true, titleAr: true, store: { select: { sellerId: true } } } } } });
    if (!q) throw new NotFoundException('Question not found');
    if (sellerId && q.product.store.sellerId !== sellerId) throw new ForbiddenException('Not your product');
    const first = q.status !== 'ANSWERED';
    // conditional: two people answering at once never both send the customer a message
    const res = await this.prisma.productQuestion.updateMany({
      where: { id, status: q.status },
      data: { status: 'ANSWERED', answer: dto.answer, answeredById: actor.id, ...(first && { answeredAt: new Date() }), rejectReason: null },
    });
    if (res.count !== 1) throw new BadRequestException('Someone else just changed this question. Refresh to see it.');
    await this.audit.log({ actorId: actor.id, action: first ? 'question.answer' : 'question.edit_answer', entityType: 'ProductQuestion', entityId: id, before: { status: q.status, answer: q.answer }, after: { answer: dto.answer } });
    this.storefront?.refresh(`product:${q.product.slug}`);
    if (first) {
      const site = this.config?.get('STOREFRONT_URL', { infer: true })?.replace(/\/$/, '');
      const locale = q.locale === 'ar' ? 'ar' : 'en';
      const product = locale === 'ar' ? q.product.titleAr || q.product.title : q.product.title;
      await this.notifications?.notify(q.userId, 'QUESTION_ANSWERED', { product, link: site ? `${site}/${locale}/p/${q.product.slug}#questions` : '' }, { productSlug: q.product.slug, questionId: id })
        .catch((e) => this.logger.warn(`answer notification failed: ${(e as Error).message}`));
    }
    return { id, status: 'ANSWERED' as const };
  }

  async reject(id: string, dto: RejectDto, actor: AuthUser, sellerId?: string) {
    const q = await this.prisma.productQuestion.findUnique({ where: { id }, select: { status: true, product: { select: { slug: true, store: { select: { sellerId: true } } } } } });
    if (!q) throw new NotFoundException('Question not found');
    if (sellerId && q.product.store.sellerId !== sellerId) throw new ForbiddenException('Not your product');
    await this.prisma.productQuestion.update({ where: { id }, data: { status: 'REJECTED', rejectReason: dto.reason ?? null } });
    await this.audit.log({ actorId: actor.id, action: 'question.reject', entityType: 'ProductQuestion', entityId: id, before: { status: q.status }, after: { reason: dto.reason ?? null } });
    if (q.status === 'ANSWERED') this.storefront?.refresh(`product:${q.product.slug}`);
    return { id, status: 'REJECTED' as const };
  }
}

@ApiTags('Questions')
@Controller({ version: '1' })
export class QuestionsController {
  constructor(private readonly svc: QuestionsService) {}

  @Public() @Get('products/:slug/questions') list(@Param('slug') slug: string, @Query() q: ListQuery) { return this.svc.forProduct(slug, q); }
  @ApiBearerAuth() @Throttle({ default: { limit: 20, ttl: 3_600_000 } }) @Post('products/:slug/questions')
  ask(@CurrentUser() u: AuthUser, @Param('slug') slug: string, @Body() d: AskDto) { return this.svc.ask(u, slug, d); }
  @ApiBearerAuth() @Get('me/questions') mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.id); }
}

@ApiTags('Admin / Questions') @ApiBearerAuth() @RequirePermissions('reviews.moderate')
@Controller({ path: 'admin/questions', version: '1' })
export class AdminQuestionsController {
  constructor(private readonly svc: QuestionsService) {}
  @Get() list(@Query() q: AdminListQuery) { return this.svc.list(q.status ?? 'PENDING', q.cursor); }
  @HttpCode(200) @Post(':id/answer') answer(@Param('id', ParseUUIDPipe) id: string, @Body() d: AnswerDto, @CurrentUser() u: AuthUser) { return this.svc.answer(id, d, u); }
  @Patch(':id/answer') edit(@Param('id', ParseUUIDPipe) id: string, @Body() d: AnswerDto, @CurrentUser() u: AuthUser) { return this.svc.answer(id, d, u); }
  @HttpCode(200) @Post(':id/reject') reject(@Param('id', ParseUUIDPipe) id: string, @Body() d: RejectDto, @CurrentUser() u: AuthUser) { return this.svc.reject(id, d, u); }
}

@ApiTags('Seller / Questions') @ApiBearerAuth() @UseGuards(SellerGuard)
@Controller({ path: 'seller/questions', version: '1' })
export class SellerQuestionsController {
  constructor(private readonly svc: QuestionsService) {}
  @Get() list(@CurrentSeller() s: SellerContext, @Query() q: AdminListQuery) { return this.svc.list(q.status ?? 'PENDING', q.cursor, s.id); }
  @HttpCode(200) @Post(':id/answer') answer(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() d: AnswerDto, @CurrentUser() u: AuthUser) { return this.svc.answer(id, d, u, s.id); }
  @HttpCode(200) @Post(':id/reject') reject(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() d: RejectDto, @CurrentUser() u: AuthUser) { return this.svc.reject(id, d, u, s.id); }
}

@Module({ controllers: [QuestionsController, AdminQuestionsController, SellerQuestionsController], providers: [QuestionsService] })
export class QuestionsModule {}
