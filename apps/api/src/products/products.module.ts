import { Module } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminProductsService } from './admin-products.service';
import { CatalogCsvService } from './catalog-csv.service';
import { AdminProductsController, PublicProductsController, SellerProductsController } from './products.controller';
import { PublicProductsService } from './public-products.service';
import { SellerProductsService } from './seller-products.service';

@Module({
  controllers: [PublicProductsController, SellerProductsController, AdminProductsController],
  providers: [SellerProductsService, AdminProductsService, PublicProductsService, AdminCatalogService, CatalogCsvService],
  exports: [PublicProductsService, AdminCatalogService],
})
export class ProductsModule {}
