import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const E164 = /^\+[1-9]\d{7,14}$/;

export class AddressDto {
  @ApiPropertyOptional({ example: 'Home' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(30) label?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) recipientName: string;
  @ApiProperty({ example: '+97455555555' }) @Transform(trim) @Matches(E164) phone: string;
  @ApiPropertyOptional({ example: 'QA' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Length(2, 2) countryCode?: string;
  @ApiProperty({ example: 'Doha' }) @Transform(trim) @IsString() @Length(2, 80) city: string;
  @ApiPropertyOptional({ example: '24', description: 'Qatar zone number' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(20) zone?: string;
  @ApiPropertyOptional({ example: '850' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) street?: string;
  @ApiPropertyOptional({ example: '12' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) building?: string;
  @ApiPropertyOptional({ example: 'Flat 3' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(60) unit?: string;
  @ApiPropertyOptional({ description: 'Free-text line for markets that do not use zone/street numbers' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) line1?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(20) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

type AddressFormat = { fields?: string[]; required?: string[] };

/** Each market defines its own required address fields in Country.addressFormat — nothing is hard-coded to Qatar. */
export function assertAddressFormat(dto: AddressDto, format: unknown) {
  const f = (format && typeof format === 'object' ? format : {}) as AddressFormat;
  const missing = (f.required ?? []).filter((key) => {
    const v = (dto as unknown as Record<string, unknown>)[key];
    return v === undefined || v === null || v === '';
  });
  if (missing.length) throw new BadRequestException({ message: 'Address is incomplete', missing });
}

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  }

  async create(userId: string, dto: AddressDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { countryCode: true } });
    const countryCode = dto.countryCode ?? user.countryCode;
    const country = await this.prisma.country.findUnique({ where: { code: countryCode }, select: { isActive: true, addressFormat: true } });
    if (!country?.isActive) throw new BadRequestException('FastMoveX does not deliver to this country yet');
    assertAddressFormat(dto, country.addressFormat);

    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= 20) throw new BadRequestException('You can save up to 20 addresses');
    const isDefault = dto.isDefault ?? count === 0;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, countryCode, isDefault, userId } });
    });
  }

  async update(userId: string, id: string, dto: AddressDto) {
    await this.mustOwn(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: { ...dto, countryCode: dto.countryCode } });
    });
  }

  async remove(userId: string, id: string) {
    await this.mustOwn(userId, id);
    await this.prisma.address.delete({ where: { id } }); // past orders keep a snapshot of the address
  }

  async setDefault(userId: string, id: string) {
    await this.mustOwn(userId, id);
    await this.prisma.$transaction([
      this.prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.address.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.list(userId);
  }

  private async mustOwn(userId: string, id: string) {
    const a = await this.prisma.address.findFirst({ where: { id, userId }, select: { id: true } });
    if (!a) throw new NotFoundException('Address not found');
    return a;
  }
}

@ApiTags('Account / Addresses')
@ApiBearerAuth()
@Controller({ path: 'addresses', version: '1' })
export class AddressesController {
  constructor(private readonly svc: AddressesService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: AddressDto) { return this.svc.create(u.id, dto); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddressDto) { return this.svc.update(u.id, id, dto); }
  @Post(':id/default') setDefault(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setDefault(u.id, id); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u.id, id); }
}

@Module({ controllers: [AddressesController], providers: [AddressesService], exports: [AddressesService] })
export class AddressesModule {}
