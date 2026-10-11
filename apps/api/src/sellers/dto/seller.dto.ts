import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { DocumentType, ReviewStatus, SellerStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const E164 = /^\+[1-9]\d{7,14}$/;

export class ApplySellerDto {
  @ApiProperty({ example: 'Doha Gadgets Trading WLL' }) @Transform(trim) @IsString() @Length(2, 120) businessName: string;
  @ApiProperty({ example: 'Doha Gadgets' }) @Transform(trim) @IsString() @Length(2, 60) storeName: string;
  @ApiPropertyOptional({ example: 'متجر الدوحة' }) @IsOptional() @Transform(trim) @IsString() @Length(2, 60) storeNameAr?: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() contactEmail: string;
  @ApiProperty({ example: '+97455555555' }) @Transform(trim) @Matches(E164, { message: 'Phone must be like +97455555555' }) contactPhone: string;
  @ApiPropertyOptional({ description: 'Qatar Commercial Registration number' }) @IsOptional() @Transform(trim) @IsString() @Length(3, 40) commercialRegNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class UpdateSellerProfileDto {
  // Legal fields: editable only before approval
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 120) businessName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 120) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 40) commercialRegNo?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 40) taxNumber?: string;
  // Always editable
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(E164) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 60) storeName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 60) storeNameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) descriptionAr?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) city?: string;
}

export class UpdateBankDto {
  @ApiProperty({ example: 'Qatar National Bank' }) @Transform(trim) @IsString() @Length(2, 80) bankName: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) accountHolder: string;
  @ApiProperty({ example: 'QA58DOHB00001234567890ABCDEFG' }) @IsString() @Length(15, 40) iban: string;
}

export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentType }) @IsEnum(DocumentType) type: DocumentType;
}

export class AdminListSellersQuery {
  @ApiPropertyOptional({ enum: SellerStatus }) @IsOptional() @IsEnum(SellerStatus) status?: SellerStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

export class ReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 1000) reason: string;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) status: Exclude<ReviewStatus, 'PENDING'>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
