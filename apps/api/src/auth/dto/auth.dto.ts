import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @ApiProperty({ example: 'Junaid Ahmed' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  fullName: string;

  @ApiPropertyOptional({ example: 'junaid@example.com' })
  @ValidateIf((o: RegisterDto) => !o.phone || o.email !== undefined)
  @Transform(trimLower)
  @IsEmail({}, { message: 'Enter a valid email' })
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: '+97455555555', description: 'E.164 format' })
  @ValidateIf((o: RegisterDto) => !o.email || o.phone !== undefined)
  @Transform(trim)
  @Matches(E164, { message: 'Phone must be in international format, e.g. +97455555555' })
  phone?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_RULE, { message: 'Password must contain at least one letter and one number' })
  password: string;

  @ApiPropertyOptional({ example: 'QA' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional({ enum: ['en', 'ar'] })
  @IsOptional()
  @IsIn(['en', 'ar'])
  locale?: 'en' | 'ar';
}

export class LoginDto {
  @ApiProperty({ example: 'junaid@example.com', description: 'Email or phone (E.164)' })
  @Transform(trim)
  @IsString()
  @Length(3, 254)
  identifier: string;

  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Mobile only. Web sends the httpOnly cookie instead.' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  currentPassword: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_RULE, { message: 'Password must contain at least one letter and one number' })
  newPassword: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'junaid@example.com', description: 'Email or phone (E.164) of the account' })
  @Transform(trim)
  @IsString()
  @Length(3, 254)
  identifier: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'junaid@example.com' })
  @Transform(trim)
  @IsString()
  @Length(3, 254)
  identifier: string;

  @ApiProperty({ example: '482913' })
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_RULE, { message: 'Password must contain at least one letter and one number' })
  newPassword: string;
}

export class VerifyRequestDto {
  @ApiProperty({ enum: ['email', 'phone'] })
  @IsIn(['email', 'phone'])
  channel: 'email' | 'phone';
}

export class VerifyConfirmDto extends VerifyRequestDto {
  @ApiProperty({ example: '482913' })
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}

export class TwoFactorLoginDto {
  @ApiProperty({ description: 'The challenge from POST /auth/login when twoFactorRequired is true' }) @IsString() @Length(20, 2000) challenge: string;
  @ApiProperty({ example: '123456', description: 'The 6-digit code from the authenticator app, or a recovery code (XXXX-XXXX)' })
  @Transform(trim) @IsString() @Length(6, 12) code: string;
}

export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456' }) @Transform(trim) @IsString() @Length(6, 12) code: string;
}

export class TwoFactorDisableDto {
  @ApiProperty() @IsString() @Length(1, 200) password: string;
  @ApiProperty({ example: '123456' }) @Transform(trim) @IsString() @Length(6, 12) code: string;
}

export class SocialLoginDto {
  @ApiProperty({ enum: ['GOOGLE', 'APPLE'] }) @IsIn(['GOOGLE', 'APPLE']) provider: 'GOOGLE' | 'APPLE';
  @ApiProperty({ description: 'The ID token (JWT) the provider gave the app or website' }) @IsString() @Length(20, 8000) idToken: string;
  @ApiPropertyOptional({ description: 'The nonce your page passed to the provider; it must come back inside the token' }) @IsOptional() @IsString() @Length(8, 200) nonce?: string;
  @ApiPropertyOptional({ description: 'Apple sends the name only the first time, to the app — pass it on for new accounts' }) @IsOptional() @Transform(trim) @IsString() @Length(2, 100) fullName?: string;
  @ApiPropertyOptional({ enum: ['en', 'ar'] }) @IsOptional() @IsIn(['en', 'ar']) locale?: 'en' | 'ar';
}
