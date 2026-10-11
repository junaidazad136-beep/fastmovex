import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param,
  ParseUUIDPipe, Post, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { AuthModule } from '../auth/auth.module';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';

export const ADMIN_ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'CATALOG_MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'SUPPORT_ADMIN', 'DELIVERY_AGENT',
] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CreateStaffDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) fullName: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
  @ApiProperty({ minLength: 12, description: 'Staff passwords are longer than customer passwords' })
  @IsString() @MinLength(12) @MaxLength(128) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { message: 'Use upper case, lower case and a number' }) password: string;
  @ApiProperty({ enum: ADMIN_ROLES, isArray: true }) @IsArray() @ArrayMaxSize(9) @IsIn(ADMIN_ROLES, { each: true }) roles: string[];
}
class SetRolesDto { @ApiProperty({ enum: ADMIN_ROLES, isArray: true }) @IsArray() @ArrayMaxSize(9) @IsIn(ADMIN_ROLES, { each: true }) roles: string[]; }
class RefundLimitDto {
  @ApiPropertyOptional({ nullable: true, example: '50000', description: 'Minor units (QAR 500.00); null = no limit' })
  @IsOptional() @Matches(/^\d{1,12}$/, { message: 'Amount in minor units, e.g. 50000' }) limitMinor?: string | null;
}
class SetPermissionsDto { @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) permissions: string[]; }
class StatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsIn(['ACTIVE', 'SUSPENDED']) status: Exclude<UserStatus, 'DELETED'>;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 300) reason: string;
}
class UsersQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional({ example: 'VIP' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z0-9_-]{2,20}$/) tag?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}
class AuditQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @ApiPropertyOptional({ example: 'payout.' }) @IsOptional() @IsString() @MaxLength(60) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

/**
 * Guard rails so an admin can never lock the company out or promote themselves (exported for tests):
 *  - only a SUPER_ADMIN can grant or remove SUPER_ADMIN
 *  - nobody changes their own roles
 *  - the last active SUPER_ADMIN cannot be demoted or suspended
 */
export function assertRoleChange(actor: AuthUser, targetId: string, currentRoles: string[], nextRoles: string[], activeSuperAdmins: number) {
  if (actor.id === targetId) throw new ForbiddenException('You cannot change your own roles');
  const touchesSuper = currentRoles.includes('SUPER_ADMIN') !== nextRoles.includes('SUPER_ADMIN');
  if (touchesSuper && !actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Only a super admin can grant or remove super admin');
  if (currentRoles.includes('SUPER_ADMIN') && !nextRoles.includes('SUPER_ADMIN') && activeSuperAdmins <= 1) {
    throw new BadRequestException('This is the last super admin');
  }
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  private superAdminCount() {
    return this.prisma.user.count({ where: { status: 'ACTIVE', roles: { some: { role: { code: 'SUPER_ADMIN' } } } } });
  }

  private rolesOf(userId: string) {
    return this.prisma.userRole.findMany({ where: { userId }, select: { role: { select: { code: true } } } }).then((r) => r.map((x) => x.role.code));
  }

  async listUsers(q: UsersQuery, staffOnly: boolean) {
    const rows = await this.prisma.user.findMany({
      where: {
        status: q.status,
        ...(q.tag && { tags: { has: q.tag } }),
        ...(staffOnly && { roles: { some: { role: { code: { in: [...ADMIN_ROLES] } } } } }),
        ...(q.q && { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q.toLowerCase() } }, { phone: { contains: q.q } }] }),
        ...afterCursor(decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      select: {
        id: true, fullName: true, email: true, phone: true, status: true, countryCode: true, createdAt: true, lastLoginAt: true, isGuest: true,
        twoFactorEnabledAt: true, lockedUntil: true, tags: true, refundLimitMinor: true,
        roles: { select: { role: { select: { code: true } } } }, _count: { select: { orders: true } },
      },
    });
    const p = toPage(rows, 25);
    const now = new Date();
    return {
      nextCursor: p.nextCursor,
      items: p.items.map(({ roles, twoFactorEnabledAt, lockedUntil, refundLimitMinor, ...u }) => ({
        ...u, roles: roles.map((r) => r.role.code), twoFactor: !!twoFactorEnabledAt, lockedUntil: lockedUntil && lockedUntil > now ? lockedUntil : null,
        ...(staffOnly && { refundLimitMinor: refundLimitMinor?.toString() ?? null }),
      })),
    };
  }

  async customerDetail(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, fullName: true, email: true, phone: true, status: true, countryCode: true, createdAt: true, lastLoginAt: true, marketingOptIn: true, isGuest: true,
        phoneVerifiedAt: true, codBlocked: true, codBlockedReason: true, codRefusals: true, _count: { select: { orders: true, returns: true } },
        deletionRequestedAt: true, deletionScheduledFor: true, deletedAt: true, tags: true,
        roles: { select: { role: { select: { code: true } } } },
        orders: { orderBy: { placedAt: 'desc' }, take: 20, select: { orderNumber: true, status: true, totalMinor: true, currencyCode: true, placedAt: true } },
        tickets: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, number: true, subject: true, status: true, createdAt: true } },
        seller: { select: { id: true, status: true, businessName: true } },
      },
    });
    if (!u) throw new NotFoundException('User not found');
    return { ...u, roles: u.roles.map((r) => r.role.code), orders: u.orders.map((o) => ({ ...o, totalMinor: o.totalMinor.toString() })) };
  }

  async createStaff(d: CreateStaffDto, actor: AuthUser) {
    if (d.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Only a super admin can create super admins');
    const roles = await this.prisma.role.findMany({ where: { code: { in: d.roles } } });
    try {
      const u = await this.prisma.user.create({
        data: {
          fullName: d.fullName, email: d.email, phone: d.phone, passwordHash: await this.passwords.hash(d.password), countryCode: 'QA', emailVerifiedAt: new Date(),
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
        select: { id: true, fullName: true, email: true },
      });
      await this.audit.log({ actorId: actor.id, action: 'staff.create', entityType: 'User', entityId: u.id, after: { roles: d.roles } });
      return { ...u, roles: d.roles };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A user with this email or phone already exists');
      throw e;
    }
  }

  /** Replaces the staff roles of a user (customer/seller roles are left untouched). Takes effect at their next token refresh (≤15 min); tokens are revoked for demotions. */
  async setRoles(targetId: string, nextStaff: string[], actor: AuthUser) {
    const current = await this.rolesOf(targetId);
    if (!current.length) throw new NotFoundException('User not found');
    const keep = current.filter((c) => !(ADMIN_ROLES as readonly string[]).includes(c));
    const next = [...new Set([...keep, ...nextStaff])];
    assertRoleChange(actor, targetId, current, next, await this.superAdminCount());

    const roles = await this.prisma.role.findMany({ where: { code: { in: next } } });
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: targetId } }),
      this.prisma.userRole.createMany({ data: roles.map((r) => ({ userId: targetId, roleId: r.id })) }),
    ]);
    const lostSomething = current.some((c) => !next.includes(c));
    if (lostSomething) await this.tokens.revokeAllForUser(targetId); // demotion applies now, not in 15 minutes
    await this.audit.log({ actorId: actor.id, action: 'user.roles_set', entityType: 'User', entityId: targetId, before: { roles: current }, after: { roles: next } });
    return { id: targetId, roles: next };
  }

  /** The biggest single refund this staff member may approve; null = no limit of their own. Nobody sets their own. */
  async setRefundLimit(targetId: string, limitMinor: string | null, actor: AuthUser) {
    if (targetId === actor.id) throw new ForbiddenException('You cannot change your own refund limit');
    const u = await this.prisma.user.findUnique({ where: { id: targetId }, select: { refundLimitMinor: true, roles: { select: { role: { select: { code: true } } } } } });
    if (!u || !u.roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r.role.code))) throw new NotFoundException('Staff member not found');
    const next = limitMinor === null ? null : BigInt(limitMinor);
    await this.prisma.user.update({ where: { id: targetId }, data: { refundLimitMinor: next } });
    await this.audit.log({ actorId: actor.id, action: 'staff.refund_limit', entityType: 'User', entityId: targetId, before: { limitMinor: u.refundLimitMinor?.toString() ?? null }, after: { limitMinor: next?.toString() ?? null } });
    return { id: targetId, refundLimitMinor: next?.toString() ?? null };
  }

  async setStatus(targetId: string, d: StatusDto, actor: AuthUser) {
    if (targetId === actor.id) throw new ForbiddenException('You cannot change your own status');
    const current = await this.rolesOf(targetId);
    if (!current.length) throw new NotFoundException('User not found');
    if (d.status === 'SUSPENDED' && current.includes('SUPER_ADMIN')) {
      if (!actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Only a super admin can suspend a super admin');
      if ((await this.superAdminCount()) <= 1) throw new BadRequestException('This is the last super admin');
    }
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { status: true } });
    await this.prisma.user.update({ where: { id: targetId }, data: { status: d.status } });
    if (d.status === 'SUSPENDED') await this.tokens.revokeAllForUser(targetId); // kicked out on every device
    await this.audit.log({ actorId: actor.id, action: `user.${d.status.toLowerCase()}`, entityType: 'User', entityId: targetId, before: { status: before.status }, after: { status: d.status, reason: d.reason } });
    return { id: targetId, status: d.status };
  }

  roles() {
    return this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, name: true, isSystem: true, permissions: { select: { permission: { select: { code: true } } } }, _count: { select: { users: true } } },
    }).then((rs) => rs.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.code) })));
  }

  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { code: 'asc' }], select: { code: true, group: true } });
  }

  /** Edit what a role can do. SUPER_ADMIN is immutable (always everything) so it can never be broken. */
  async setRolePermissions(code: string, perms: string[], actor: AuthUser) {
    if (code === 'SUPER_ADMIN') throw new BadRequestException('Super admin always has every permission');
    const role = await this.prisma.role.findUnique({ where: { code }, include: { permissions: { select: { permission: { select: { code: true } } } } } });
    if (!role) throw new NotFoundException('Role not found');
    const found = await this.prisma.permission.findMany({ where: { code: { in: perms } } });
    if (found.length !== new Set(perms).size) throw new BadRequestException('Unknown permission in the list');
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      this.prisma.rolePermission.createMany({ data: found.map((p) => ({ roleId: role.id, permissionId: p.id })) }),
    ]);
    await this.audit.log({ actorId: actor.id, action: 'role.permissions_set', entityType: 'Role', entityId: code, before: { permissions: role.permissions.map((p) => p.permission.code) }, after: { permissions: perms } });
    return { code, permissions: perms };
  }

  async auditLogs(q: AuditQuery) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        actorId: q.actorId, entityType: q.entityType, entityId: q.entityId,
        ...(q.action && { action: { startsWith: q.action } }),
        ...afterCursor(decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    const page = toPage(rows, 50);
    // Show who did it by name; the id stays for filtering.
    const ids = [...new Set(page.items.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    return { ...page, items: page.items.map((r) => ({ ...r, actorName: r.actorId ? names.get(r.actorId) ?? null : null })) };
  }
}

@ApiTags('Admin / Users & Access') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @RequirePermissions('users.read') @Get('users') users(@Query() q: UsersQuery) { return this.svc.listUsers(q, false); }
  @RequirePermissions('users.read') @Get('users/:id') user(@Param('id', ParseUUIDPipe) id: string) { return this.svc.customerDetail(id); }
  @RequirePermissions('users.suspend') @HttpCode(200) @Post('users/:id/status') status(@Param('id', ParseUUIDPipe) id: string, @Body() d: StatusDto, @CurrentUser() u: AuthUser) { return this.svc.setStatus(id, d, u); }

  @RequirePermissions('admins.manage') @Get('staff') staff(@Query() q: UsersQuery) { return this.svc.listUsers(q, true); }
  @RequirePermissions('admins.manage') @Post('staff') createStaff(@Body() d: CreateStaffDto, @CurrentUser() u: AuthUser) { return this.svc.createStaff(d, u); }
  @RequirePermissions('admins.manage') @Put('staff/:id/refund-limit') refundLimit(@Param('id', ParseUUIDPipe) id: string, @Body() d: RefundLimitDto, @CurrentUser() u: AuthUser) { return this.svc.setRefundLimit(id, d.limitMinor ?? null, u); }
  @RequirePermissions('admins.manage') @Put('staff/:id/roles') setRoles(@Param('id', ParseUUIDPipe) id: string, @Body() d: SetRolesDto, @CurrentUser() u: AuthUser) { return this.svc.setRoles(id, d.roles, u); }

  @RequirePermissions('roles.manage') @Get('roles') roles() { return this.svc.roles(); }
  @RequirePermissions('roles.manage') @Get('permissions') permissions() { return this.svc.permissions(); }
  @RequirePermissions('roles.manage') @Put('roles/:code/permissions') setPerms(@Param('code') code: string, @Body() d: SetPermissionsDto, @CurrentUser() u: AuthUser) { return this.svc.setRolePermissions(code, d.permissions, u); }

  @RequirePermissions('audit.read') @Get('audit-logs') audit(@Query() q: AuditQuery) { return this.svc.auditLogs(q); }
}

@Module({ imports: [AuthModule], controllers: [AdminUsersController], providers: [AdminUsersService] })
export class AdminUsersModule {}
