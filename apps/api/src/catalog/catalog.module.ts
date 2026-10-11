import { Global, Module } from '@nestjs/common';
import { ProductCardService } from './product-card.service';
import { SitemapController, SitemapService } from './sitemap.controller';

@Global()
@Module({ controllers: [SitemapController], providers: [ProductCardService, SitemapService], exports: [ProductCardService] })
export class CatalogModule {}
