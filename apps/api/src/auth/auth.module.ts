import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Env } from '../config/env';
import { AccountSecurityService } from './account-security.service';
import { AdminSecurityController, AuthController } from './auth.controller';
import { LoginSecurityService } from './login-security.service';
import { TwoFactorService } from './two-factor.service';
import { OtpService } from './otp.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SocialAuthService } from './social-auth';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true, // global JwtAuthGuard needs JwtService everywhere
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'fastmovex-api' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'fastmovex-api' },
      }),
    }),
  ],
  controllers: [AuthController, AdminSecurityController],
  providers: [AuthService, PasswordService, TokenService, OtpService, AccountSecurityService, LoginSecurityService, TwoFactorService, SocialAuthService],
  exports: [AuthService, PasswordService, TokenService, OtpService, LoginSecurityService, TwoFactorService],
})
export class AuthModule {}
