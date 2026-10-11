import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Optional, Param, ParseUUIDPipe,
  Patch, Post, Query,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { randomBytes } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from '../audit/audit.service';
import { CacheService } from '../cache/cache.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { EVENTS } from '../notifications/notification.events';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const TICKET_CATEGORIES = ['order', 'delivery', 'payment', 'refund', 'return', 'account', 'seller', 'other'] as const;

class CreateTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 150) subject: string;
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 5000) message: string;
  @ApiPropertyOptional({ example: 'FMX-QA-260922-4F9A2C' }) @IsOptional() @IsString() @MaxLength(40) orderNumber?: string;
}
class MessageDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) message: string;
  @ApiPropertyOptional({ description: 'Admin only: note visible to staff, never to the customer' }) @IsOptional() @IsBoolean() internal?: boolean;
}
class AdminTicketPatch {
  @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @ApiPropertyOptional({ enum: TicketPriority }) @IsOptional() @IsEnum(TicketPriority) priority?: TicketPriority;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToId?: string;
}
class AdminTicketQuery {
  @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @ApiPropertyOptional({ enum: TicketPriority }) @IsOptional() @IsEnum(TicketPriority) priority?: TicketPriority;
  @ApiPropertyOptional({ description: '"me" = assigned to me' }) @IsOptional() @IsString() assigned?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class FaqDto {
  @ApiPropertyOptional() @IsOptional() @Length(2, 2) countryCode?: string;
  @ApiProperty() @IsIn(TICKET_CATEGORIES) category: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 300) question: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 300) questionAr: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 5000) answer: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 5000) answerAr: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Urgent topics jump the queue. Exported for tests. */
export function initialPriority(category: string): TicketPriority {
  return category === 'payment' || category === 'refund' ? 'HIGH' : 'NORMAL';
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateTicketDto) {
    const open = await this.prisma.supportTicket.count({ where: { userId, status: { in: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_SELLER'] } } });
    if (open >= 10) throw new BadRequestException('You have too many open tickets. Please reply to an existing one.');

    let orderId: string | undefined;
    if (dto.orderNumber) {
      const o = await this.prisma.order.findFirst({ where: { orderNumber: dto.orderNumber, userId }, select: { id: true } });
      if (!o) throw new NotFoundException('Order not found in your account');
      orderId = o.id;
    }
    const seller = await this.prisma.seller.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    const number = `SUP-${randomBytes(4).toString('hex').toUpperCase()}`;

    const ticket = await this.prisma.supportTicket.create({
      data: {
        number, userId, sellerId: dto.category === 'seller' ? seller?.id : undefined, orderId, subject: dto.subject, category: dto.category,
        priority: initialPriority(dto.category), messages: { create: { authorId: userId, body: dto.message } },
      },
      select: { id: true, number: true, status: true, priority: true, createdAt: true },
    });
    return ticket;
  }

  async listMine(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50,
      select: { number: true, subject: true, category: true, status: true, updatedAt: true, order: { select: { orderNumber: true } } },
    });
  }

  /** Customers never see internal staff notes or who the staff member is. */
  async detailMine(userId: string, number: string) {
    const t = await this.prisma.supportTicket.findFirst({
      where: { number, userId },
      select: {
        number: true, subject: true, category: true, status: true, createdAt: true, order: { select: { orderNumber: true } },
        messages: { where: { isInternal: false }, orderBy: { createdAt: 'asc' }, select: { body: true, createdAt: true, authorId: true } },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found');
    return { ...t, messages: t.messages.map((m) => ({ body: m.body, createdAt: m.createdAt, fromYou: m.authorId === userId })) };
  }

  async replyAsCustomer(userId: string, number: string, message: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { number, userId }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status === 'CLOSED') throw new BadRequestException('This ticket is closed. Please open a new one.');
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: userId, body: message } }),
      this.prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN' } }),
    ]);
    return this.detailMine(userId, number);
  }

  async closeMine(userId: string, number: string) {
    const res = await this.prisma.supportTicket.updateMany({ where: { number, userId, status: { not: 'CLOSED' } }, data: { status: 'CLOSED' } });
    if (!res.count) throw new NotFoundException('Ticket not found or already closed');
    return { number, status: 'CLOSED' };
  }

  // ------------------------------------------------------------------ admin

  async adminList(q: AdminTicketQuery, adminId: string) {
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        status: q.status, priority: q.priority,
        ...(q.assigned === 'me' ? { assignedToId: adminId } : q.assigned === 'none' ? { assignedToId: null } : {}),
        ...afterCursor(decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: { id: true, number: true, subject: true, category: true, status: true, priority: true, assignedToId: true, createdAt: true, updatedAt: true, user: { select: { fullName: true } }, order: { select: { orderNumber: true } } },
    });
    return toPage(rows, 25);
  }

  async adminDetail(id: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        order: { select: { orderNumber: true, status: true, totalMinor: true, currencyCode: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { fullName: true } } } },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found');
    return { ...t, order: t.order && { ...t.order, totalMinor: t.order.totalMinor.toString() } };
  }

  async adminReply(id: string, admin: AuthUser, dto: MessageDto) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true, assignedToId: true } });
    if (!t) throw new NotFoundException('Ticket not found');
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: admin.id, body: dto.message, isInternal: !!dto.internal } }),
      this.prisma.supportTicket.update({
        where: { id },
        data: { assignedToId: t.assignedToId ?? admin.id, ...(dto.internal ? {} : { status: 'PENDING_CUSTOMER' }) },
      }),
    ]);
    await this.audit.log({ actorId: admin.id, action: 'ticket.reply', entityType: 'SupportTicket', entityId: id, after: { internal: !!dto.internal, autoAssigned: !t.assignedToId } });
    if (!dto.internal) this.events?.emit(EVENTS.TICKET_REPLIED, { id });
    return this.adminDetail(id);
  }

  async adminUpdate(id: string, admin: AuthUser, dto: AdminTicketPatch) {
    await this.prisma.supportTicket.update({ where: { id }, data: dto }).catch(() => { throw new NotFoundException('Ticket not found'); });
    await this.audit.log({ actorId: admin.id, action: 'ticket.update', entityType: 'SupportTicket', entityId: id, after: { ...dto } });
    return this.adminDetail(id);
  }

  // -------------------------------------------------------------------- FAQ

  faq(country: string, category?: string) {
    return this.cache.wrap(`faq:${country}:${category ?? 'all'}`, 300, () =>
      this.prisma.faqEntry.findMany({
        where: { isActive: true, category, OR: [{ countryCode: null }, { countryCode: country }] },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
        select: { id: true, category: true, question: true, questionAr: true, answer: true, answerAr: true },
      }),
    );
  }

  async faqCreate(dto: FaqDto, adminId: string) {
    const f = await this.prisma.faqEntry.create({ data: { ...dto, countryCode: dto.countryCode?.toUpperCase() } });
    await this.audit.log({ actorId: adminId, action: 'faq.create', entityType: 'FaqEntry', entityId: f.id });
    return f;
  }

  async faqUpdate(id: string, dto: Partial<FaqDto>, adminId: string) {
    const f = await this.prisma.faqEntry.update({ where: { id }, data: dto }).catch(() => { throw new NotFoundException('FAQ not found'); });
    await this.audit.log({ actorId: adminId, action: 'faq.update', entityType: 'FaqEntry', entityId: id });
    return f;
  }

  async faqDelete(id: string, adminId: string) {
    await this.prisma.faqEntry.delete({ where: { id } }).catch(() => { throw new NotFoundException('FAQ not found'); });
    await this.audit.log({ actorId: adminId, action: 'faq.delete', entityType: 'FaqEntry', entityId: id });
  }
}

@ApiTags('Support')
@Controller({ version: '1' })
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  @Public() @Get('faq') faq(@Headers('x-country') c?: string, @Query('category') cat?: string) { return this.svc.faq((c ?? 'QA').toUpperCase().slice(0, 2), cat); }

  @ApiBearerAuth() @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('support/tickets') create(@CurrentUser() u: AuthUser, @Body() d: CreateTicketDto) { return this.svc.create(u.id, d); }
  @ApiBearerAuth() @Get('support/tickets') mine(@CurrentUser() u: AuthUser) { return this.svc.listMine(u.id); }
  @ApiBearerAuth() @Get('support/tickets/:number') detail(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.detailMine(u.id, n); }
  @ApiBearerAuth() @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Post('support/tickets/:number/messages') reply(@CurrentUser() u: AuthUser, @Param('number') n: string, @Body() d: MessageDto) { return this.svc.replyAsCustomer(u.id, n, d.message); }
  @ApiBearerAuth() @HttpCode(200) @Post('support/tickets/:number/close') close(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.closeMine(u.id, n); }
}

@ApiTags('Admin / Support') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminSupportController {
  constructor(private readonly svc: SupportService) {}

  @RequirePermissions('tickets.read') @Get('tickets') list(@Query() q: AdminTicketQuery, @CurrentUser() u: AuthUser) { return this.svc.adminList(q, u.id); }
  @RequirePermissions('tickets.read') @Get('tickets/:id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.svc.adminDetail(id); }
  @RequirePermissions('tickets.reply') @Post('tickets/:id/messages') reply(@Param('id', ParseUUIDPipe) id: string, @Body() d: MessageDto, @CurrentUser() u: AuthUser) { return this.svc.adminReply(id, u, d); }
  @RequirePermissions('tickets.reply') @Patch('tickets/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() d: AdminTicketPatch, @CurrentUser() u: AuthUser) { return this.svc.adminUpdate(id, u, d); }

  @RequirePermissions('settings.manage') @Post('faq') faqCreate(@Body() d: FaqDto, @CurrentUser() u: AuthUser) { return this.svc.faqCreate(d, u.id); }
  @RequirePermissions('settings.manage') @Patch('faq/:id') faqUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() d: FaqDto, @CurrentUser() u: AuthUser) { return this.svc.faqUpdate(id, d, u.id); }
  @RequirePermissions('settings.manage') @HttpCode(204) @Delete('faq/:id') faqDelete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.svc.faqDelete(id, u.id); }
}

@Module({ controllers: [SupportController, AdminSupportController], providers: [SupportService] })
export class SupportModule {}
