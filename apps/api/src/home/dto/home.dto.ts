import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, ValidateIf } from 'class-validator';

export class HomeQueryDto {
  @ApiPropertyOptional({ example: 25.2854 }) @ValidateIf((o: HomeQueryDto) => o.lng !== undefined || o.lat !== undefined)
  @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional({ example: 51.531 }) @ValidateIf((o: HomeQueryDto) => o.lat !== undefined || o.lng !== undefined)
  @Type(() => Number) @IsLongitude() lng?: number;
}

