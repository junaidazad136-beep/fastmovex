import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value);

/** Text for search engines, in both languages. Empty string = remove. Lengths follow what Google shows. */
export class SeoFieldsDto {
  @ApiPropertyOptional({ description: 'Intro text shown on the page (plain text, paragraphs separated by blank lines)' }) @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(5000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(5000) descriptionAr?: string | null;
  @ApiPropertyOptional({ description: 'Title in Google (≤ 70; "| FastMoveX" is added)' }) @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(70) seoTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(70) seoTitleAr?: string | null;
  @ApiPropertyOptional({ description: 'Description in Google (≤ 170)' }) @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(170) seoDescription?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(170) seoDescriptionAr?: string | null;
}

export class FaqItemDto {
  @IsString() @Length(3, 200) q: string;
  @IsString() @Length(2, 200) qAr: string;
  @IsString() @Length(3, 1500) a: string;
  @IsString() @Length(2, 1500) aAr: string;
}

export class FaqFieldDto {
  @ApiPropertyOptional({ type: [FaqItemDto], description: 'Questions shown on the page and as FAQ structured data (both languages, ≤ 20)' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FaqItemDto) faq?: FaqItemDto[];
}
