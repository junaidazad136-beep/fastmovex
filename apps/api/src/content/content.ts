import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Optional, Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ContactStatus, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { requestMeta } from '../common/utils/request-meta';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontService } from '../common/storefront.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Addresses the website already uses for its own screens: a content page cannot take them. */
export const RESERVED_SLUGS = [
  'account', 'api', 'c', 'cart', 'categories', 'checkout', 'contact', 'forgot-password', 'help', 'login', 'offers', 'p', 'register',
  'reset-password', 'search', 'sitemap', 'sitemaps', 'store', 'track', 'robots', 'manifest', 'offline', 'icons', 'en', 'ar', 'brand', 'brands', 'feeds',
];

export class PageDto {
  @ApiProperty({ example: 'about' }) @Transform(trim) @Matches(SLUG, { message: 'Web address: lowercase letters, numbers and dashes' }) @Length(2, 60) slug: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) titleAr: string;
  @ApiProperty({ description: 'Plain text; ## heading, - list, **bold**, [link](https://…)' }) @IsString() @MaxLength(50_000) body: string;
  @ApiProperty() @IsString() @MaxLength(50_000) bodyAr: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showInFooter?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class ContactDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(200) email: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'Enter a valid phone number' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(150) subject?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 5000) message: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) orderNumber?: string;
  /** Honeypot: people never see this field; bots fill it in. */
  @ApiPropertyOptional({ description: 'Leave empty' }) @IsOptional() @IsString() @MaxLength(200) website?: string;
}

/** Change only what is sent (e.g. just publish a draft). */
export class UpdatePageDto extends PartialType(PageDto) {}

class ContactQuery {
  @ApiPropertyOptional({ enum: ContactStatus }) @IsOptional() @IsEnum(ContactStatus) status?: ContactStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class ContactPatch {
  @ApiPropertyOptional({ enum: ContactStatus }) @IsOptional() @IsEnum(ContactStatus) status?: ContactStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

const PUBLIC_PAGE = { slug: true, title: true, titleAr: true, showInFooter: true, sortOrder: true, updatedAt: true } as const;

@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService, private readonly audit: AuditService, @Optional() private readonly storefront?: StorefrontService) {}

  /** Published pages for the footer and sitemap. */
  list() {
    return this.cache.wrap('pages:public', 300, () =>
      this.prisma.page.findMany({ where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }], select: PUBLIC_PAGE }),
    );
  }

  async get(slug: string) {
    const p = await this.prisma.page.findFirst({ where: { slug: slug.toLowerCase(), isPublished: true }, select: { ...PUBLIC_PAGE, body: true, bodyAr: true } });
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  adminList() {
    return this.prisma.page.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] });
  }

  async adminGet(id: string) {
    const p = await this.prisma.page.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  async create(d: PageDto, actor: AuthUser) {
    this.assertSlug(d.slug);
    const p = await this.guard(() => this.prisma.page.create({ data: { ...d, updatedById: actor.id } }));
    await this.changed(actor, 'page.create', p.id, { slug: p.slug, isPublished: p.isPublished });
    return p;
  }

  async update(id: string, d: Partial<PageDto>, actor: AuthUser) {
    if (d.slug) this.assertSlug(d.slug);
    const p = await this.guard(() => this.prisma.page.update({ where: { id }, data: { ...d, updatedById: actor.id } }));
    await this.changed(actor, 'page.update', id, { slug: p.slug, isPublished: p.isPublished, fields: Object.keys(d) });
    return p;
  }

  async remove(id: string, actor: AuthUser) {
    await this.guard(() => this.prisma.page.delete({ where: { id } }));
    await this.changed(actor, 'page.delete', id, {});
  }

  private assertSlug(slug: string) {
    if (RESERVED_SLUGS.includes(slug)) throw new BadRequestException(`"${slug}" is already used by the website. Choose another web address.`);
  }

  private async changed(actor: AuthUser, action: string, id: string, after: Record<string, unknown>) {
    await this.cache.del('pages:public');
    this.storefront?.refresh('pages', 'sitemap');
    await this.audit.log({ actorId: actor.id, action, entityType: 'Page', entityId: id, after: after as Prisma.InputJsonValue });
  }

  private async guard<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Another page already uses this web address');
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Page not found');
      throw e;
    }
  }
}

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Stored for the team (Admin › Messages). Bots that fill the hidden field get the same answer and nothing is stored. */
  async submit(d: ContactDto, userId: string | undefined, ip: string | undefined) {
    if (d.website) return { received: true };
    const recent = await this.prisma.contactMessage.count({ where: { email: d.email, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recent >= 5) return { received: true }; // flooding: accept quietly, store nothing more
    await this.prisma.contactMessage.create({
      data: { name: d.name, email: d.email, phone: d.phone, subject: d.subject, message: d.message, orderNumber: d.orderNumber?.toUpperCase(), userId, ip: ip?.slice(0, 64) },
    });
    return { received: true };
  }

  async list(q: ContactQuery) {
    const rows = await this.prisma.contactMessage.findMany({
      where: { status: q.status, ...afterCursor(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    });
    return toPage(rows, 25);
  }

  async update(id: string, d: ContactPatch, actor: AuthUser) {
    try {
      const m = await this.prisma.contactMessage.update({
        where: { id },
        data: { status: d.status, note: d.note, ...(d.status && d.status !== 'NEW' ? { handledById: actor.id, handledAt: new Date() } : {}) },
      });
      await this.audit.log({ actorId: actor.id, action: 'contact.update', entityType: 'ContactMessage', entityId: id, after: { status: m.status } });
      return m;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Message not found');
      throw e;
    }
  }
}

@ApiTags('Content')
@Controller({ version: '1' })
export class ContentController {
  constructor(private readonly pages: PagesService, private readonly contact: ContactService) {}

  @Public() @Get('pages') list() { return this.pages.list(); }
  @Public() @Get('pages/:slug') get(@Param('slug') slug: string) { return this.pages.get(slug); }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @HttpCode(202)
  @Post('contact')
  send(@Body() d: ContactDto, @Req() req: Request, @CurrentUser() u?: AuthUser) { return this.contact.submit(d, u?.id, requestMeta(req).ip); }
}

@ApiTags('Admin / Content') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminContentController {
  constructor(private readonly pages: PagesService, private readonly contact: ContactService) {}

  @RequirePermissions('settings.manage') @Get('pages') list() { return this.pages.adminList(); }
  @RequirePermissions('settings.manage') @Get('pages/:id') get(@Param('id', ParseUUIDPipe) id: string) { return this.pages.adminGet(id); }
  @RequirePermissions('settings.manage') @Post('pages') create(@Body() d: PageDto, @CurrentUser() u: AuthUser) { return this.pages.create(d, u); }
  @RequirePermissions('settings.manage') @Patch('pages/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() d: UpdatePageDto, @CurrentUser() u: AuthUser) { return this.pages.update(id, d, u); }
  @RequirePermissions('settings.manage') @HttpCode(204) @Delete('pages/:id') remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.pages.remove(id, u); }

  @RequirePermissions('tickets.read') @Get('contact-messages') messages(@Query() q: ContactQuery) { return this.contact.list(q); }
  @RequirePermissions('tickets.reply') @Patch('contact-messages/:id') message(@Param('id', ParseUUIDPipe) id: string, @Body() d: ContactPatch, @CurrentUser() u: AuthUser) { return this.contact.update(id, d, u); }
}

@Module({ controllers: [ContentController, AdminContentController], providers: [PagesService, ContactService], exports: [PagesService] })
export class ContentModule {}
