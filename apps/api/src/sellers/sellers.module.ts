import { Module } from '@nestjs/common';
import { AdminSellersService } from './admin-sellers.service';
import { AdminSellerHealthController, SellerHealthController, SellerHealthService } from './health';
import { AdminSellersController, SellerAccountController, SellerApplyController } from './sellers.controller';
import { SellerOnboardingService } from './seller-onboarding.service';

@Module({
  controllers: [SellerApplyController, SellerAccountController, AdminSellersController, SellerHealthController, AdminSellerHealthController],
  providers: [SellerOnboardingService, AdminSellersService, SellerHealthService],
})
export class SellersModule {}
