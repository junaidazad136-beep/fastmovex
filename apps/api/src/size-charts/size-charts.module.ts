import { Global, Module } from '@nestjs/common';
import { AdminSizeChartsController, SellerSizeChartsController } from './size-charts.controller';
import { SizeChartsService } from './size-charts.service';

@Global()
@Module({
  controllers: [AdminSizeChartsController, SellerSizeChartsController],
  providers: [SizeChartsService],
  exports: [SizeChartsService],
})
export class SizeChartsModule {}
