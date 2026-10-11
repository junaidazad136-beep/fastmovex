import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser, SellerContext } from '../auth-user';
import { ALLOW_PENDING_SELLER_KEY } from '../decorators/auth.decorators';

/**
 * Put on every seller controller: @UseGuards(SellerGuard)
 * Loads the seller that belongs to the logged-in user and attaches it as req.seller.
 * Seller id is NEVER taken from the URL or body, so seller A can never act as seller B.
 */
@Injectable()
export class SellerGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser; seller?: SellerContext }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!user.roles.includes('SELLER')) throw new ForbiddenException('Seller account required');

    const seller = await this.prisma.seller.findUnique({
      where: { ownerUserId: user.id },
      select: { id: true, status: true, countryCode: true },
    });
    if (!seller) throw new ForbiddenException('Seller profile not found');
    if (seller.status === 'SUSPENDED') throw new ForbiddenException('Seller account is suspended');

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_SELLER_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // PENDING / UNDER_REVIEW / REJECTED sellers can only reach onboarding routes (to fix and resubmit)
    if (seller.status !== 'APPROVED' && !allowPending) {
      throw new ForbiddenException(
        seller.status === 'REJECTED' ? 'Seller application was rejected. Update it and resubmit.' : 'Seller account is awaiting approval',
      );
    }

    req.seller = seller;
    return true;
  }
}
