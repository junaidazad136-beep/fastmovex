import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Tags staff pick from; any other short word is allowed too (e.g. "CORPORATE"). */
export const SUGGESTED_TAGS = ['VIP', 'RISKY', 'WHOLESALE', 'CORPORATE', 'INFLUENCER'] as const;
export const MAX_TAGS = 10;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Tags are stored upper-case, A–Z/0–9 with "-" or "_" inside, 2–20 characters, without duplicates.
 * Returns the cleaned list or throws. Exported for tests.
 */
export function normaliseTags(input: string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.trim().toUpperCase().replace(/\s+/g, '_');
    if (!t) continue;
    if (!/^[A-Z0-9][A-Z0-9_-]{0,18}[A-Z0-9]$/.test(t)) throw new BadRequestException(`"${raw.trim()}" is not a valid tag (2–20 letters or numbers)`);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > MAX_TAGS) throw new BadRequestException(`At most ${MAX_TAGS} tags`);
  return out;
}

class NoteDto {
  @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @Length(1, 2000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
}
class PinDto { @ApiProperty() @IsBoolean() pinned: boolean; }
class TagsDto { @ApiProperty({ type: [String], example: ['VIP'] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 30, { each: true }) tags: string[]; }
class OrderNoteDto { @ApiProperty({ maxLength: 2000 }) @Transform(trim) @IsString() @Length(1, 2000) body: string; }

const author = { select: { id: true, fullName: true } } as const;

/**
 * Staff-only notes and tags on customers, and staff notes on orders. None of this is ever sent to the customer:
 * the customer-facing order and profile endpoints do not select these fields.
 */
@Injectable()
export class CustomerNotesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async customer(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, tags: true } });
    if (!u) throw new NotFoundException('Customer not found');
    return u;
  }

  async notes(userId: string) {
    await this.customer(userId);
    const notes = await this.prisma.customerNote.findMany({
      where: { userId }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 100,
      select: { id: true, body: true, pinned: true, createdAt: true, updatedAt: true, author },
    });
    return { items: notes };
  }

  async addNote(userId: string, d: NoteDto, actor: AuthUser) {
    await this.customer(userId);
    const n = await this.prisma.$transaction(async (tx) => {
      // only one pinned note per customer: it is the one shown on every order
      if (d.pinned) await tx.customerNote.updateMany({ where: { userId, pinned: true }, data: { pinned: false } });
      return tx.customerNote.create({ data: { userId, authorId: actor.id, body: d.body, pinned: !!d.pinned }, select: { id: true, body: true, pinned: true, createdAt: true, updatedAt: true, author } });
    });
    await this.audit.log({ actorId: actor.id, action: 'customer.note_add', entityType: 'User', entityId: userId, after: { noteId: n.id, pinned: n.pinned } });
    return n;
  }

  private async note(userId: string, noteId: string) {
    const n = await this.prisma.customerNote.findFirst({ where: { id: noteId, userId } });
    if (!n) throw new NotFoundException('Note not found');
    return n;
  }

  async pin(userId: string, noteId: string, pinned: boolean, actor: AuthUser) {
    await this.note(userId, noteId);
    await this.prisma.$transaction(async (tx) => {
      if (pinned) await tx.customerNote.updateMany({ where: { userId, pinned: true, id: { not: noteId } }, data: { pinned: false } });
      await tx.customerNote.update({ where: { id: noteId }, data: { pinned } });
    });
    await this.audit.log({ actorId: actor.id, action: pinned ? 'customer.note_pin' : 'customer.note_unpin', entityType: 'User', entityId: userId, after: { noteId } });
    return this.notes(userId);
  }

  /** The author may delete their own note; anyone else needs users.update. */
  async removeNote(userId: string, noteId: string, actor: AuthUser) {
    const n = await this.note(userId, noteId);
    if (n.authorId !== actor.id && !actor.permissions.includes('users.update')) throw new ForbiddenException('Only the author or a manager can delete this note');
    await this.prisma.customerNote.delete({ where: { id: noteId } });
    await this.audit.log({ actorId: actor.id, action: 'customer.note_delete', entityType: 'User', entityId: userId, before: { noteId, body: n.body.slice(0, 200) } });
    return { ok: true };
  }

  async setTags(userId: string, tags: string[], actor: AuthUser) {
    const u = await this.customer(userId);
    const next = normaliseTags(tags);
    await this.prisma.user.update({ where: { id: userId }, data: { tags: next } });
    await this.audit.log({ actorId: actor.id, action: 'customer.tags_set', entityType: 'User', entityId: userId, before: { tags: u.tags }, after: { tags: next } });
    return { tags: next };
  }

  /** Tags in use, most used first (for the filter and the tag picker). */
  async tagsInUse() {
    const rows = await this.prisma.$queryRaw<{ tag: string; n: number }[]>`
      SELECT t AS tag, count(*)::int AS n FROM "User", unnest(tags) AS t WHERE "deletedAt" IS NULL GROUP BY t ORDER BY n DESC, t LIMIT 50`;
    return { suggested: SUGGESTED_TAGS, inUse: rows.map((r) => ({ tag: r.tag, customers: r.n })) };
  }

  // ------------------------------------------------------------------ orders

  private async order(orderNumber: string) {
    const o = await this.prisma.order.findUnique({ where: { orderNumber }, select: { id: true, userId: true } });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  /** Staff notes on the order, plus the customer's tags and pinned note so whoever handles the order sees them. */
  async orderNotes(orderNumber: string) {
    const o = await this.order(orderNumber);
    const [notes, customer, pinned] = await Promise.all([
      this.prisma.orderNote.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, body: true, createdAt: true, author } }),
      o.userId ? this.prisma.user.findUnique({ where: { id: o.userId }, select: { id: true, tags: true } }) : null,
      o.userId ? this.prisma.customerNote.findFirst({ where: { userId: o.userId, pinned: true }, select: { id: true, body: true, createdAt: true, author } }) : null,
    ]);
    return { items: notes, customer: customer ? { id: customer.id, tags: customer.tags, pinnedNote: pinned } : null };
  }

  async addOrderNote(orderNumber: string, body: string, actor: AuthUser) {
    const o = await this.order(orderNumber);
    const n = await this.prisma.orderNote.create({ data: { orderId: o.id, authorId: actor.id, body }, select: { id: true, body: true, createdAt: true, author } });
    await this.audit.log({ actorId: actor.id, action: 'order.note_add', entityType: 'Order', entityId: o.id, after: { orderNumber, noteId: n.id } });
    return n;
  }
}

@ApiTags('Admin / Customer notes') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class CustomerNotesController {
  constructor(private readonly svc: CustomerNotesService) {}

  @RequirePermissions('users.read') @Get('customer-tags') tags() { return this.svc.tagsInUse(); }
  @RequirePermissions('users.read') @Get('users/:id/notes') notes(@Param('id', ParseUUIDPipe) id: string) { return this.svc.notes(id); }
  /** Anyone who can see the customer may leave a note (support writes most of them). */
  @RequirePermissions('users.read') @Post('users/:id/notes')
  add(@Param('id', ParseUUIDPipe) id: string, @Body() d: NoteDto, @CurrentUser() u: AuthUser) { return this.svc.addNote(id, d, u); }
  @RequirePermissions('users.update') @Patch('users/:id/notes/:noteId')
  pin(@Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string, @Body() d: PinDto, @CurrentUser() u: AuthUser) { return this.svc.pin(id, noteId, d.pinned, u); }
  @RequirePermissions('users.read') @HttpCode(200) @Delete('users/:id/notes/:noteId')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string, @CurrentUser() u: AuthUser) { return this.svc.removeNote(id, noteId, u); }
  @RequirePermissions('users.update') @Put('users/:id/tags')
  setTags(@Param('id', ParseUUIDPipe) id: string, @Body() d: TagsDto, @CurrentUser() u: AuthUser) { return this.svc.setTags(id, d.tags, u); }

  @RequirePermissions('orders.read') @Get('orders/:orderNumber/notes') orderNotes(@Param('orderNumber') n: string) { return this.svc.orderNotes(n); }
  @RequirePermissions('orders.read') @Post('orders/:orderNumber/notes')
  addOrderNote(@Param('orderNumber') n: string, @Body() d: OrderNoteDto, @CurrentUser() u: AuthUser) { return this.svc.addOrderNote(n, d.body, u); }
}

@Module({ controllers: [CustomerNotesController], providers: [CustomerNotesService] })
export class CustomerNotesModule {}
