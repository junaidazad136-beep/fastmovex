import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { MINOR_AMOUNT_REGEX } from '../../common/utils/money';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MINOR_MSG = { message: 'Amount must be a whole number in minor units, e.g. "15000" for QAR 150.00' };
const BARCODE = /^[A-Za-z0-9-]{4,48}$/;
const BARCODE_MSG = { message: 'Barcode: 4-48 letters, digits or dashes' };
/** Tags are stored lowercase and de-duplicated: "Gift", " gift " and "GIFT" are one tag. */
const normalizeTags = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean))] : value;

export class VariantInputDto {
  @ApiProperty({ example: 'IP15P-256-BLK' }) @Transform(trim) @Matches(/^[A-Za-z0-9._-]{1,64}$/, { message: 'SKU: letters, numbers, . _ - only (max 64)' })
  sku: string;
  @ApiPropertyOptional({ example: { color: 'Black', storage: '256GB' } }) @IsOptional() @IsObject()
  optionValues?: Record<string, string>;
  @ApiProperty({ example: '429900' }) @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) priceMinor: string;
  @ApiPropertyOptional({ example: '469900' }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) compareAtMinor?: string;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) initialStock?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) weightGrams?: number;
  @ApiPropertyOptional({ example: '0194253397441', description: 'EAN/UPC/GTIN' }) @IsOptional() @Transform(trim) @Matches(BARCODE, BARCODE_MSG) barcode?: string;
  @ApiPropertyOptional({ example: '350000', description: 'What one unit costs you (minor units). Never shown to customers.' })
  @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) costPriceMinor?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) lengthMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) widthMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) heightMm?: number;
}

class ProductFieldsDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 200) titleAr?: string;
  @ApiPropertyOptional({ description: 'One or two lines shown near the price' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) shortDescription?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) shortDescriptionAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) descriptionAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string;
  @ApiPropertyOptional({ example: { Display: '6.1"', Chip: 'A17 Pro' } }) @IsOptional() @IsObject() specs?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(90) returnPolicyDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(120) warrantyMonths?: number;
  @ApiPropertyOptional({ nullable: true, description: "Size guide shown next to the size option (FastMoveX's or your store's); null = the category's default" })
  @IsOptional() @IsUUID() sizeChartId?: string | null;
  @ApiPropertyOptional({ description: 'Food, cosmetics, medicine: keep stock in dated lots, sell earliest-expiry first, write off expired' }) @IsOptional() @IsBoolean() tracksExpiry?: boolean;
  @ApiPropertyOptional({ example: ['gift', 'eid'], description: 'Up to 20 keywords, stored lowercase' })
  @IsOptional() @Transform(normalizeTags) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 40, { each: true }) tags?: string[];
  @ApiPropertyOptional({ description: 'Search engine title (defaults to the product title)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(70) seoTitle?: string;
  @ApiPropertyOptional({ description: 'Search engine description (defaults to the description)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(170) seoDescription?: string;
  @ApiPropertyOptional({ description: 'true = send to admin review now, false/empty = save as draft' })
  @IsOptional() @IsBoolean() submitForReview?: boolean;
}

export class CreateProductDto extends ProductFieldsDto {
  @ApiProperty({ example: 'iPhone 15 Pro' }) @Transform(trim) @IsString() @Length(3, 200) title: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ type: [VariantInputDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VariantInputDto)
  variants: VariantInputDto[];
}

export class UpdateProductDto extends ProductFieldsDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
}

export class UpdateVariantDto {
  @ApiPropertyOptional() @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) priceMinor?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null removes the old price' })
  @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) compareAtMinor?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() optionValues?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) weightGrams?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9._-]{1,64}$/, { message: 'SKU: letters, numbers, . _ - only (max 64)' }) sku?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(trim) @Matches(BARCODE, BARCODE_MSG) barcode?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) costPriceMinor?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) lengthMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) widthMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) heightMm?: number;
}

export class AdjustStockDto {
  @ApiProperty({ example: 25, description: 'Positive to add, negative to remove. 0 only together with lowStockThreshold (alert level change).' })
  @IsInt() @Min(-1_000_000) @Max(1_000_000) delta: number;
  @ApiProperty({ enum: ['RESTOCK', 'ADJUSTMENT', 'DAMAGED', 'EXPIRED', 'LOST', 'FOUND'], description: 'DAMAGED / EXPIRED / LOST only remove; RESTOCK / FOUND only add' })
  @IsIn(['RESTOCK', 'ADJUSTMENT', 'DAMAGED', 'EXPIRED', 'LOST', 'FOUND']) reason: 'RESTOCK' | 'ADJUSTMENT' | 'DAMAGED' | 'EXPIRED' | 'LOST' | 'FOUND';
  @ApiPropertyOptional({ example: '2027-03-31', description: 'Products that track expiry: the date on the units being added (required for a restock)' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiresOn must be YYYY-MM-DD' }) expiresOn?: string;
  @ApiPropertyOptional({ example: 'B-2210' }) @IsOptional() @IsString() @MaxLength(40) lotCode?: string;
  @ApiPropertyOptional({ description: 'Removing a specific dated lot (e.g. writing off an expired one)' }) @IsOptional() @IsUUID() lotId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) lowStockThreshold?: number;
  @ApiPropertyOptional({ description: 'Warehouse to add to / take from (default warehouse when omitted)' }) @IsOptional() @IsUUID() warehouseId?: string;
}

export class SellerProductsQuery {
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class AdminProductsQuery {
  @ApiPropertyOptional({ enum: ProductStatus }) @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sellerId?: string;
  @ApiPropertyOptional({ description: 'true = only FastMoveX\'s own store, false = only marketplace sellers' })
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() house?: boolean;
  @ApiPropertyOptional({ description: 'Title (EN/AR), SKU, barcode or tag' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string;
  @ApiPropertyOptional({ enum: ['low', 'out'] }) @IsOptional() @IsIn(['low', 'out']) stock?: 'low' | 'out';
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() featured?: boolean;
  @ApiPropertyOptional({ enum: ['newest', 'updated', 'title', 'price_asc', 'price_desc', 'best_selling'] })
  @IsOptional() @IsIn(['newest', 'updated', 'title', 'price_asc', 'price_desc', 'best_selling']) sort?: 'newest' | 'updated' | 'title' | 'price_asc' | 'price_desc' | 'best_selling';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AdminCreateProductDto extends CreateProductDto {
  @ApiPropertyOptional({ description: 'Store to create it in. Default: FastMoveX\'s own store.' }) @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE'], description: 'ACTIVE publishes immediately (needs at least one image — upload, then publish)' })
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE']) status?: 'DRAFT' | 'ACTIVE';
}

export class AdminProductStatusDto {
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }) @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

export class AdminBulkProductsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
  @ApiProperty({ enum: ['publish', 'draft', 'archive', 'feature', 'unfeature'] })
  @IsIn(['publish', 'draft', 'archive', 'feature', 'unfeature']) action: 'publish' | 'draft' | 'archive' | 'feature' | 'unfeature';
}

export class InventoryQuery {
  @ApiPropertyOptional({ description: 'Product title, SKU or barcode' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['low', 'out'] }) @IsOptional() @IsIn(['low', 'out']) stock?: 'low' | 'out';
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() house?: boolean;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional({ description: 'Show the stock of one warehouse (warehouseOnHand) instead of only the total' }) @IsOptional() @IsUUID() warehouseId?: string;
}

class BulkVariantChange {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiPropertyOptional() @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) priceMinor?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(MINOR_AMOUNT_REGEX, MINOR_MSG) compareAtMinor?: string | null;
  @ApiPropertyOptional({ description: 'New on-hand quantity (the difference is recorded as an adjustment)' })
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) onHand?: number;
}

export class BulkVariantsDto {
  @ApiProperty({ type: [BulkVariantChange] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BulkVariantChange)
  changes: BulkVariantChange[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ description: 'onHand values are counts in this warehouse (default: totals, differences go to the default warehouse)' }) @IsOptional() @IsUUID() warehouseId?: string;
}

/** Which option value (a colour) a photo shows; null = the photo is for every option. */
export class ImageVariantDto {
  @ApiProperty({ nullable: true, description: 'A variant of the same product, or null' }) @IsOptional() @IsUUID() variantId: string | null;
}

export class ReorderImagesDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) imageIds: string[];
}

export class ModerationDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(5, 1000) reason?: string;
}
