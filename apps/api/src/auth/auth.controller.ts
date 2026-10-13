import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CookieOptions, Request, Response } from 'express';
import { AuthUser } from '../common/auth-user';
import { AllowWithoutTwoFactor, CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { isAdminClient, isMobileClient, requestMeta } from '../common/utils/request-meta';
import { Env } from '../config/env';
import { AccountSecurityService } from './account-security.service';
import { AuthService, isChallenge } from './auth.service';
import { LoginClient, LoginSecurityService } from './login-security.service';
import { TwoFactorService } from './two-factor.service';
import {
  ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, SocialLoginDto, TwoFactorCodeDto, TwoFactorDisableDto, TwoFactorLoginDto, VerifyConfirmDto, VerifyRequestDto,
} from './dto/auth.dto';
import { IssuedTokens } from './token.service';
import { SocialAuthService } from './social-auth';

export const REFRESH_COOKIE = 'fmx_rt';
/** The admin panel keeps its own session cookie, so signing in to the shop never replaces a staff session (or the reverse). */
export const ADMIN_REFRESH_COOKIE = 'fmx_admin_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const WEB_CSRF_HEADER = 'x-requested-with';
export const WEB_CSRF_VALUE = 'fastmovex-web';

function cookieName(req: Request): string {
  return isAdminClient(req) ? ADMIN_REFRESH_COOKIE : REFRESH_COOKIE;
}

export function clientOf(req: Request): LoginClient {
  return isAdminClient(req) ? 'admin' : isMobileClient(req) ? 'mobile' : 'web';
}

@ApiTags('Auth')
@ApiHeader({ name: 'X-Client-Type', required: false, description: '"mobile" = refresh token in body instead of cookie; "admin" = admin panel session (staff only, separate cookie)' })
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly security: AccountSecurityService,
    private readonly twoFactor: TwoFactorService,
    private readonly logins: LoginSecurityService,
    private readonly social: SocialAuthService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.register(dto, requestMeta(req));
    this.security.sendWelcomeVerification(tokens.userId, requestMeta(req));
    return this.send(req, res, tokens);
  }

  /** Same answer whether or not the account exists. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @HttpCode(202)
  @Post('password/forgot')
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    this.security.forgotPassword(dto.identifier, requestMeta(req));
    return { message: 'If an account exists for this email or phone, a reset code has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(204)
  @Post('password/reset')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.security.resetPassword(dto.identifier, dto.code, dto.newPassword, requestMeta(req));
    res.clearCookie(cookieName(req), this.cookieOptions());
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @HttpCode(202)
  @Post('verify/request')
  verifyRequest(@CurrentUser() user: AuthUser, @Body() dto: VerifyRequestDto, @Req() req: Request) {
    return this.security.requestVerification(user.id, dto.channel, requestMeta(req));
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(200)
  @Post('verify/confirm')
  verifyConfirm(@CurrentUser() user: AuthUser, @Body() dto: VerifyConfirmDto, @Req() req: Request) {
    return this.security.confirmVerification(user.id, dto.channel, dto.code, requestMeta(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, requestMeta(req), { staffOnly: isAdminClient(req), client: clientOf(req) });
    // two-step sign-in on: no tokens yet, only the challenge for POST /auth/2fa/login
    return isChallenge(r) ? r : this.send(req, res, r);
  }

  /** Which "Sign in with …" buttons to show (the web client id per provider; null = off). */
  @Public() @Get('social/providers') socialProviders() { return this.social.providers(); }

  /**
   * Sign in or sign up with Google / Apple using the provider's ID token. Customers only. New account → `created: true`.
   * An account with two-step sign-in answers with a challenge, like /auth/login.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('social')
  async socialLogin(@Body() dto: SocialLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.loginSocial(dto, requestMeta(req), { staffOnly: isAdminClient(req), client: clientOf(req) });
    if (isChallenge(r)) return r;
    return { ...this.send(req, res, r as IssuedTokens), created: !!(r as { created?: boolean }).created };
  }

  @ApiBearerAuth() @Get('social') linkedSignIns(@CurrentUser() u: AuthUser) { return this.social.linked(u.id); }
  @ApiBearerAuth() @HttpCode(200) @Delete('social/:provider')
  unlink(@CurrentUser() u: AuthUser, @Param('provider') p: string) {
    const provider = p.toUpperCase();
    if (provider !== 'GOOGLE' && provider !== 'APPLE') throw new ForbiddenException('Unknown provider');
    return this.social.unlink(u.id, provider);
  }

  /** Second step of signing in: the authenticator code (or a recovery code) with the challenge from /auth/login. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/login')
  async loginWithCode(@Body() dto: TwoFactorLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.send(req, res, await this.auth.loginWithCode(dto, requestMeta(req), { staffOnly: isAdminClient(req), client: clientOf(req) }));
  }

  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Get('2fa')
  twoFactorStatus(@CurrentUser() user: AuthUser) { return this.twoFactor.status(user); }

  /** Step 1 of turning it on: a secret and the otpauth:// link for the QR code. */
  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(200)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: AuthUser) { return this.twoFactor.setup(user.id); }

  /** Step 2: the first code turns it on. Other devices are signed out; this one gets a fresh session; recovery codes are shown once. */
  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @HttpCode(200)
  @Post('2fa/enable')
  async enableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorCodeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const recoveryCodes = await this.twoFactor.enable(user, dto.code, requestMeta(req));
    const tokens = await this.auth.issueVerified(user.id, requestMeta(req));
    return { recoveryCodes, ...this.send(req, res, tokens) };
  }

  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @HttpCode(200)
  @Post('2fa/recovery-codes')
  async newRecoveryCodes(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorCodeDto, @Req() req: Request) {
    return { recoveryCodes: await this.twoFactor.regenerateRecovery(user.id, dto.code, requestMeta(req)) };
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @HttpCode(204)
  @Post('2fa/disable')
  async disableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorDisableDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.twoFactor.disable(user, dto.password, dto.code, requestMeta(req));
    res.clearCookie(cookieName(req), this.cookieOptions());
  }

  /** Devices signed in to this account (one per sign-in), the current one marked. */
  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) { return this.logins.sessions(user.id, user.sessionId); }

  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @HttpCode(204)
  @Delete('sessions/:id')
  async endSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.logins.revokeSession(user.id, id, requestMeta(req));
  }

  /** Recent sign-in attempts on this account (successful and failed). */
  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Get('login-history')
  loginHistory(@CurrentUser() user: AuthUser) { return this.logins.history(user.id); }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Never clear the cookie on failure here: a tab that lost a refresh race would wipe the winner's fresh cookie.
    return this.send(req, res, await this.auth.refresh(this.readRefresh(req, dto), requestMeta(req), { staffOnly: isAdminClient(req) }));
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.readRefresh(req, dto));
    res.clearCookie(cookieName(req), this.cookieOptions());
  }

  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @HttpCode(204)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutAll(user.id, requestMeta(req));
    res.clearCookie(cookieName(req), this.cookieOptions());
  }

  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    await this.auth.changePassword(user.id, dto, requestMeta(req));
  }

  @ApiBearerAuth() @AllowWithoutTwoFactor()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { ...(await this.auth.me(user.id)), twoFactor: await this.twoFactor.status(user) };
  }

  // ---------------------------------------------------------------- helpers

  private send(req: Request, res: Response, t: IssuedTokens) {
    if (isMobileClient(req)) {
      return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn };
    }
    res.cookie(cookieName(req), t.refreshToken, { ...this.cookieOptions(), expires: t.refreshExpiresAt });
    return { accessToken: t.accessToken, expiresIn: t.expiresIn };
  }

  private readRefresh(req: Request, dto: RefreshDto): string | undefined {
    if (isMobileClient(req)) return dto.refreshToken;
    const cookie: unknown = req.cookies?.[cookieName(req)];
    if (typeof cookie !== 'string') return undefined;
    // CSRF defence for cookie auth: browsers cannot add custom headers on cross-site form posts.
    if (req.headers[WEB_CSRF_HEADER] !== WEB_CSRF_VALUE) throw new ForbiddenException('Missing CSRF header');
    return cookie;
  }

  private cookieOptions(): CookieOptions {
    const prod = this.config.get('NODE_ENV', { infer: true }) === 'production';
    return {
      httpOnly: true,
      secure: prod,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      domain: this.config.get('COOKIE_DOMAIN', { infer: true }) || undefined,
    };
  }
}

/** Staff security tools: another admin clears a lost authenticator; anyone's sign-in history. */
@ApiTags('Admin / Users & Access') @ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminSecurityController {
  constructor(private readonly twoFactor: TwoFactorService, private readonly logins: LoginSecurityService) {}

  @RequirePermissions('admins.manage') @HttpCode(200) @Post('staff/:id/2fa/reset')
  reset(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.twoFactor.adminReset(id, u, requestMeta(req)); }

  @RequirePermissions('users.read') @Get('users/:id/login-history')
  history(@Param('id', ParseUUIDPipe) id: string) { return this.logins.historyFor(id); }
}
