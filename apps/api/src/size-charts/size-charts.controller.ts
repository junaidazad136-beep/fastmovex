import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSizeChartDto, UpdateSizeChartDto } from './size-charts.dto';
import { SizeChartsService } from './size-charts.service';

const SHARED = { storeId: null };

@ApiTags('Admin / Size charts')
@ApiBearerAuth()
@Controller({ path: 'admin/size-charts', version: '1' })
export class AdminSizeChartsController {
  constructor(private readonly charts: SizeChartsService) {}

  @RequirePermissions('products.read') @Get()
  list() { return this.charts.listShared(); }

  @RequirePermissions('products.read') @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.charts.get(id, SHARED); }

  @RequirePermissions('products.manage') @Post()
  create(@Body() dto: CreateSizeChartDto, @CurrentUser() u: AuthUser) { return this.charts.create(SHARED, dto, u.id); }

  @RequirePermissions('products.manage') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSizeChartDto, @CurrentUser() u: AuthUser) { return this.charts.update(SHARED, id, dto, u.id); }

  @RequirePermissions('products.manage') @Delete(':id') @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { await this.charts.remove(SHARED, id, u.id); }
}

@ApiTags('Seller / Size charts')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@Controller({ path: 'seller/size-charts', version: '1' })
export class SellerSizeChartsController {
  constructor(private readonly charts: SizeChartsService, private readonly prisma: PrismaService) {}

  private async owner(s: SellerContext) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { sellerId: s.id }, select: { id: true } });
    return { storeId: store.id };
  }

  /** FastMoveX's charts (use them as they are) and your store's own. */
  @Get()
  async list(@CurrentSeller() s: SellerContext) { return this.charts.listForStore((await this.owner(s)).storeId); }

  @Post()
  async create(@CurrentSeller() s: SellerContext, @Body() dto: CreateSizeChartDto, @CurrentUser() u: AuthUser) { return this.charts.create(await this.owner(s), dto, u.id); }

  @Patch(':id')
  async update(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSizeChartDto, @CurrentUser() u: AuthUser) {
    return this.charts.update(await this.owner(s), id, dto, u.id);
  }

  @Delete(':id') @HttpCode(204)
  async remove(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    await this.charts.remove(await this.owner(s), id, u.id);
  }
}
