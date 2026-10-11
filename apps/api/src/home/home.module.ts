import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { SearchModule } from '../search/search.module';
import { AdminHomeController, HomeController, OffersController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [CategoriesModule, SearchModule],
  controllers: [HomeController, OffersController, AdminHomeController],
  providers: [HomeService],
})
export class HomeModule {}
