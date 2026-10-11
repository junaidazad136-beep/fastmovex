import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { MINOR_AMOUNT_REGEX } from '../../common/utils/money';
import { SearchSort, SORTS } from '../search.types';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const cleanQ = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || undefined : value;

export class SearchQueryDto {
  @ApiPropertyOptional({ example: 'iphone 15' }) @IsOptional() @Transform(cleanQ) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ example: 'phones-accessories' }) @IsOptional() @Matches(SLUG) @MaxLength(80) category?: string;
  @ApiPropertyOptional({ example: 'apple,samsung', description: 'Comma-separated brand slugs' })
  @IsOptional() @Matches(/^[a-z0-9-]+(,[a-z0-9-]+){0,19}$/, { message: 'brands: up to 20 comma-separated slugs' }) brands?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(SLUG) @MaxLength(80) store?: string;
  @ApiPropertyOptional({ example: '10000' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) minPrice?: string;
  @ApiPropertyOptional({ example: '500000' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX) maxPrice?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) minRating?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() inStock?: boolean;
  @ApiPropertyOptional({ enum: SORTS, default: 'relevance' }) @IsOptional() @IsIn(SORTS) sort?: SearchSort;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page?: number;
  @ApiPropertyOptional({ default: 24, maximum: 48 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) limit?: number;
  @ApiPropertyOptional({ default: true, description: 'false = search exactly what was typed ("Search instead for …")' })
  @IsOptional() @Transform(({ value }) => !(value === false || value === 'false' || value === '0')) @IsBoolean() spell?: boolean;
}

export class SearchLogDto {
  @ApiProperty({ example: 'oud' }) @Transform(cleanQ) @IsString() @Length(1, 100) q: string;
  @ApiProperty({ description: 'How many results the customer saw' }) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) total: number;
  @ApiPropertyOptional({ description: 'The results were for a spelling correction' }) @IsOptional() @IsBoolean() corrected?: boolean;
}

export class SearchReportQuery {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

export class SuggestQueryDto {
  @ApiPropertyOptional({ example: 'iph' }) @Transform(cleanQ) @IsString() @Length(2, 60) q: string;
}
