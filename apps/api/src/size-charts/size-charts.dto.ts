import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { SIZE_CHART_KINDS } from './size-chart';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSizeChartDto {
  @ApiProperty({ example: "Men's shirts" }) @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiProperty({ example: 'قمصان رجالية' }) @Transform(trim) @IsString() @Length(1, 80) nameAr: string;
  @ApiPropertyOptional({ enum: SIZE_CHART_KINDS, description: 'Picks the "how to measure" tips' }) @IsOptional() @IsIn(SIZE_CHART_KINDS) kind?: string;
  @ApiProperty({ example: [{ label: 'Size', labelAr: 'المقاس', unit: null }, { label: 'Chest', labelAr: 'الصدر', unit: 'cm' }] })
  @IsArray() columns: unknown[];
  @ApiProperty({ example: [['M', '97–102'], ['L', '107–112']] }) @IsArray() rows: unknown[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(400) note?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(400) noteAr?: string;
}

export class UpdateSizeChartDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 80) nameAr?: string;
  @ApiPropertyOptional({ enum: SIZE_CHART_KINDS }) @IsOptional() @IsIn(SIZE_CHART_KINDS) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() columns?: unknown[];
  @ApiPropertyOptional() @IsOptional() @IsArray() rows?: unknown[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(400) note?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(400) noteAr?: string;
}
