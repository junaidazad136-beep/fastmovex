import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../auth-user';
import { PERMISSIONS_KEY, ROLES_KEY } from '../decorators/auth.decorators';

/**
 * Global guard, runs after JwtAuthGuard.
 * @Roles  -> user needs at least one of the roles.
 * @RequirePermissions -> user needs every permission.
 * No bypass for any role: SUPER_ADMIN gets every permission through the seed, explicitly.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets);
    const perms = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    if (!roles?.length && !perms?.length) return true;

    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException('Authentication required');

    if (roles?.length && !roles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException('You do not have access to this resource');
    }
    if (perms?.length && !perms.every((p) => user.permissions.includes(p))) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }
}
