import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { FaqFieldDto, SeoFieldsDto } from '../../seo/seo-fields.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateCategoryDto extends IntersectionType(SeoFieldsDto, FaqFieldDto) {
  @ApiProperty({ example: 'Smartwatches' }) @IsString() @Length(2, 80) name: string;
  @ApiProperty({ example: 'الساعات الذكية' }) @IsString() @Length(1, 80) nameAr: string;
  @ApiPropertyOptional({ example: 'smartwatches' })
  @IsOptional() @Matches(SLUG, { message: 'slug: lowercase letters, numbers and dashes only' }) @Length(2, 80)
  slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Default size guide (FastMoveX charts only)' }) @IsOptional() @IsUUID() sizeChartId?: string | null;
}

export class UpdateCategoryDto extends IntersectionType(SeoFieldsDto, FaqFieldDto) {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(SLUG) @Length(2, 80) slug?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null = move to top level' })
  @IsOptional() @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Default size guide for products here (and in subcategories) that come in sizes; null = none' })
  @IsOptional() @IsUUID() sizeChartId?: string | null;
}

export class ReorderItemDto {
  @IsUUID() id: string;
  @IsInt() @Min(0) @Max(10_000) sortOrder: number;
}

export class ReorderCategoriesDto {
  @ApiProperty({ type: [ReorderItemDto] })
  @ValidateNested({ each: true }) @Type(() => ReorderItemDto) @ArrayMinSize(1) @ArrayMaxSize(500)
  items: ReorderItemDto[];
}
