import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TwoFactorGuard } from './common/guards/two-factor.guard';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AddressesModule } from './addresses/addresses';
import { AdminUsersModule } from './admin/admin-users';
import { DashboardModule } from './admin/dashboard';
import { AnalyticsModule } from './analytics/analytics.module';
import { TrafficModule } from './analytics/traffic';
import { AuditModule } from './audit/audit.module';
import { BrandsModule } from './brands/brands';
import { CacheModule } from './cache/cache.service';
import { CartModule } from './cart/cart.module';
import { CouponsModule } from './coupons/coupons';
import { CatalogModule } from './catalog/catalog.module';
import { CountryModule } from './common/country/country.service';
import { CommissionModule } from './commission/commission.service';
import { DeliveryModule } from './delivery/delivery.module';
import { StockControlModule } from './inventory/stock-control';
import { PurchasingModule } from './purchasing/purchasing';
import { PrivacyModule } from './account/privacy';
import { InsightsModule } from './admin/insights';
import { CustomerNotesModule } from './admin/customer-notes';
import { StaffAlertsModule } from './notifications/staff-alerts';
import { ReturnsLogisticsModule } from './delivery/returns-logistics';
import { DocumentsModule } from './documents/documents';
import { ReconciliationModule } from './payments/reconciliation';
import { FinanceModule } from './finance/finance.controllers';
import { MarketingModule } from './marketing/marketing';
import { ContentModule } from './content/content';
import { HomeModule } from './home/home.module';
import { LedgerModule } from './ledger/ledger.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { ReviewsModule } from './reviews/reviews';
import { QuestionsModule } from './questions/questions';
import { WarehousesModule } from './warehouses/warehouses';
import { SupportModule } from './support/support';
import { WishlistModule } from './wishlist/wishlist';
import { CartRemindersModule } from './marketing/cart-reminders';
import { StorefrontModule } from './common/storefront.service';
import { PaymentsModule } from './payments/payments.controller';
import { SearchModule } from './search/search.module';
import { SettingsModule } from './settings/countries.admin';
import { StoresModule } from './stores/stores.controller';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { CryptoModule } from './common/crypto/crypto.service';
import { AccessGuard } from './common/guards/access.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validateEnv } from './config/env';
import { isTrustedInternalRead } from './common/utils/internal-key';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { PricingModule } from './pricing/pricing.module';
import { ProductsModule } from './products/products.module';
import { SizeChartsModule } from './size-charts/size-charts.module';
import { SellersModule } from './sellers/sellers.module';
import { StorageModule } from './storage/storage.service';

import { SeoModule } from './seo/seo';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }], // 120 req/min per IP by default, stricter on auth routes
      // Integration tests log in dozens of times per minute. Never skippable in production.
      // The website's own server (SSR) is trusted for read-only requests via INTERNAL_API_KEY.
      skipIf: (ctx) => (process.env.RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production') || isTrustedInternalRead(ctx),
    }),
    PrismaModule,
    AuditModule,
    CacheModule,
    CountryModule,
    StorefrontModule,
    CartRemindersModule,
    CatalogModule,
    CryptoModule,
    StorageModule,
    AuthModule,
    CategoriesModule,
    SellersModule,
    ProductsModule,
    SizeChartsModule,
    BrandsModule,
    SearchModule,
    HomeModule,
    ContentModule,
    StoresModule,
    PricingModule,
    CartModule,
    CouponsModule,
    AddressesModule,
    CommissionModule,
    LedgerModule,
    PaymentsModule,
    OrdersModule,
    FinanceModule,
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false }),
    NotificationsModule,
    ReviewsModule, QuestionsModule, WarehousesModule,
    WishlistModule,
    SupportModule,
    DeliveryModule,
    StockControlModule,
    PurchasingModule,
    ReconciliationModule,
    DocumentsModule,
    PrivacyModule,
    InsightsModule,
    CustomerNotesModule,
    StaffAlertsModule,
    ReturnsLogisticsModule,
    AnalyticsModule, TrafficModule,
    MarketingModule,
    AdminUsersModule,
    DashboardModule,
    SettingsModule,
    SeoModule,
    // Background jobs (hourly seller balance release). Off in tests.
    ...(process.env.NODE_ENV === 'test' ? [] : [ScheduleModule.forRoot()]),
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit -> who are you -> are you allowed
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TwoFactorGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
