import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminSellersService } from './admin-sellers.service';
import { AdminSellerHealthController, SellerHealthController, SellerHealthService } from './health';
import { AdminSellersController, SellerAccountController, SellerApplyController } from './sellers.controller';
import { SellerOnboardingService } from './seller-onboarding.service';
import { LatePackingService } from './late-packing';

@Module({
  imports: [AuthModule],
  controllers: [SellerApplyController, SellerAccountController, AdminSellersController, SellerHealthController, AdminSellerHealthController],
  providers: [LatePackingService, SellerOnboardingService, AdminSellersService, SellerHealthService],
})
export class SellersModule {}
