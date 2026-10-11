import { Global, Module } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { ConfigDeliveryQuoter } from './delivery-quoter';

@Global()
@Module({ providers: [CouponService, ConfigDeliveryQuoter], exports: [CouponService, ConfigDeliveryQuoter] })
export class PricingModule {}
