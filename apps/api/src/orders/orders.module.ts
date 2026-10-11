import { TrafficModule } from '../analytics/traffic';
import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CashModule } from '../cash/cash';
import { AuthModule } from '../auth/auth.module';
import { CommissionModule } from '../commission/commission.service';
import { SlotsModule } from '../delivery/slots.module';
import { PaymentsModule } from '../payments/payments.controller';
import { CheckoutService } from './checkout.service';
import { GuestCheckoutController, GuestCheckoutService, GuestOrdersController } from './guest-checkout';
import { AdminOrdersController, CheckoutController, OrdersController, SellerOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PhoneOrdersController, PhoneOrdersService } from './phone-orders';
import { AdminOrderChangesController, CustomerOrderChangesController, GuestOrderChangesController, OrderChangesService } from './order-changes';

@Module({
  imports: [CartModule, CommissionModule, PaymentsModule, SlotsModule, TrafficModule, CashModule, AuthModule],
  controllers: [GuestCheckoutController, GuestOrdersController, CheckoutController, OrdersController, SellerOrdersController, AdminOrdersController, AdminOrderChangesController, CustomerOrderChangesController, GuestOrderChangesController, PhoneOrdersController],
  providers: [CheckoutService, OrdersService, GuestCheckoutService, OrderChangesService, PhoneOrdersService],
  exports: [OrdersService, OrderChangesService],
})
export class OrdersModule {}
