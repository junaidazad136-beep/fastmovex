import { Module } from '@nestjs/common';
import { AdminSellersService } from './admin-sellers.service';
import { AdminSellersController, SellerAccountController, SellerApplyController } from './sellers.controller';
import { SellerOnboardingService } from './seller-onboarding.service';

@Module({
  controllers: [SellerApplyController, SellerAccountController, AdminSellersController],
  providers: [SellerOnboardingService, AdminSellersService],
})
export class SellersModule {}
