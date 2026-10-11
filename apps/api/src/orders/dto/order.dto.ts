import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { OrderTrafficDto } from '../../analytics/traffic';
import { ValidateNested, IsBoolean, IsEnum, IsIn, IsISO8601, Matches, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CheckoutDto {
  @ApiProperty() @IsUUID() addressId: string;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @ApiPropertyOptional({ description: 'Note for the seller / courier' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ description: 'Where the gateway sends the customer back after 3-D Secure' })
  @IsOptional() @IsString() @MaxLength(300) returnUrl?: string;
  @ApiPropertyOptional({ example: '2026-10-02T06:00:00.000Z', description: 'Start of the delivery window from GET /delivery/slots' })
  @IsOptional() @IsISO8601({ strict: true }) deliverySlot?: string;
  @ApiPropertyOptional({ description: 'Customer agrees to order updates on WhatsApp (uses the account mobile, or the delivery mobile when the account has none)' })
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @ApiPropertyOptional({ type: OrderTrafficDto, description: 'Where the visit came from (website analytics), so sales can be reported by source' })
  @IsOptional() @ValidateNested() @Type(() => OrderTrafficDto) traffic?: OrderTrafficDto;
}

export class CancelDto {
  @ApiProperty() @IsString() @Length(3, 500) reason: string;
}

export class UpdateSellerOrderStatusDto {
  @ApiProperty({ enum: ['PREPARING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] })
  @IsIn(['PREPARING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'])
  status: OrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
  @ApiPropertyOptional({ example: '4821', description: 'FastMoveX-driver delivery: the 4-digit code the customer received' })
  @IsOptional() @Matches(/^\d{4}$/, { message: 'code must be 4 digits' }) code?: string;
  @ApiPropertyOptional({ description: 'Manager only (delivery.override): why it is marked delivered without the customer’s code' })
  @IsOptional() @IsString() @MaxLength(300) overrideReason?: string;
}

export class OrdersQuery {
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) q?: string;
  /** Admin: only orders with at least one shipment still to prepare or hand over (confirmed, preparing, ready). */
  @ApiPropertyOptional({ enum: ['to_fulfil'] }) @IsOptional() @IsIn(['to_fulfil']) view?: 'to_fulfil';
  /** Admin: orders whose delivery window is on this local date (YYYY-MM-DD) */
  @ApiPropertyOptional({ example: '2026-10-02' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) slotDate?: string;
}
