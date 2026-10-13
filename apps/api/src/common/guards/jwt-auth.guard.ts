import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AccessTokenPayload } from '../auth-user';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = this.extractBearer(req);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'], issuer: 'fastmovex-api' });
      if (payload.typ !== 'access' || !payload.sub) throw new Error('wrong token type');
      req.user = { id: payload.sub, roles: payload.roles ?? [], permissions: payload.perms ?? [], mfa: payload.mfa === true, sessionId: payload.sid };
      return true;
    } catch {
      if (isPublic) return true; // bad token on a public route = treat as guest
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractBearer(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type === 'Bearer' && value ? value : undefined;
  }
}
