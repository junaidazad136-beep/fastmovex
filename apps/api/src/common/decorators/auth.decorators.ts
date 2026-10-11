import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser, SellerContext } from '../auth-user';

export const IS_PUBLIC_KEY = 'jovia:isPublic';
export const PERMISSIONS_KEY = 'jovia:permissions';
export const ROLES_KEY = 'jovia:roles';
export const ALLOW_PENDING_SELLER_KEY = 'jovia:allowPendingSeller';
export const ALLOW_WITHOUT_2FA_KEY = 'jovia:allowWithout2fa';

/** Route needs no login. If a valid token is sent anyway, req.user is still filled (for personalization). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** User must have ALL listed permissions, e.g. @RequirePermissions('payouts.approve') */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

/** User must have AT LEAST ONE listed role, e.g. @Roles('SELLER') */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Reachable by staff who still have to set up two-step sign-in (setting it up, signing out, who am I). */
export const AllowWithoutTwoFactor = () => SetMetadata(ALLOW_WITHOUT_2FA_KEY, true);

/** Lets a PENDING / UNDER_REVIEW seller reach onboarding routes (upload docs, edit profile). */
export const AllowPendingSeller = () => SetMetadata(ALLOW_PENDING_SELLER_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest().user;
});

/** Filled by SellerGuard. ALWAYS scope seller queries with this id, never with an id from the URL/body. */
export const CurrentSeller = createParamDecorator((_: unknown, ctx: ExecutionContext): SellerContext => {
  return ctx.switchToHttp().getRequest().seller;
});
