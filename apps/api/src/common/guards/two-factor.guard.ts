import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Env } from '../../config/env';
import { AuthUser } from '../auth-user';
import { ALLOW_WITHOUT_2FA_KEY } from '../decorators/auth.decorators';

/** Permissions that do not make someone staff (drivers use the driver page only). */
const NOT_STAFF = new Set(['delivery.update_own']);
export const isStaffUser = (u: Pick<AuthUser, 'permissions'>) => u.permissions.some((p) => !NOT_STAFF.has(p));

export function staffTwoFactorRequired(config: ConfigService<Env, true>): boolean {
  const mode = config.get('STAFF_TWO_FACTOR', { infer: true }) as 'required' | 'optional' | undefined;
  return (mode ?? (config.get('NODE_ENV', { infer: true }) === 'production' ? 'required' : 'optional')) === 'required';
}

/**
 * Global guard, after JwtAuthGuard. When two-step sign-in is required for staff, a staff session that did not pass
 * the code can only set it up (routes marked @AllowWithoutTwoFactor). Customers, sellers and drivers are not affected.
 */
@Injectable()
export class TwoFactorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || user.mfa || !isStaffUser(user)) return true;
    if (!staffTwoFactorRequired(this.config)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_2FA_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    throw new ForbiddenException({ message: 'Set up two-step sign-in to use the staff tools.', reason: 'TWO_FACTOR_SETUP_REQUIRED' });
  }
}
