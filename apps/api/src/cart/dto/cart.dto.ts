import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export const MAX_QTY_PER_LINE = 99;
export const MAX_CART_LINES = 50;

export class AddCartItemDto {
  @ApiProperty() @IsUUID() variantId: string;
  @ApiProperty({ minimum: 1, maximum: MAX_QTY_PER_LINE }) @IsInt() @Min(1) @Max(MAX_QTY_PER_LINE) quantity: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 0, maximum: MAX_QTY_PER_LINE, description: '0 removes the item' }) @IsInt() @Min(0) @Max(MAX_QTY_PER_LINE) quantity: number;
}

export class ApplyCouponDto {
  @ApiProperty({ example: 'WELCOME10' }) @IsString() @Length(3, 40) @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Code: letters, numbers, - and _ only' }) code: string;
}

export class MergeCartDto {
  @ApiProperty() @IsString() @Length(20, 64) guestToken: string;
}
