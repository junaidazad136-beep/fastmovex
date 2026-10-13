import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, SellerContext } from '../common/auth-user';
import { CurrentSeller, CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { UPLOAD_LIMITS } from '../storage/file-validation';
import { AdminProductsService } from './admin-products.service';
import { AdminCatalogService } from './admin-catalog.service';
import { CatalogCsvService } from './catalog-csv.service';
import {
  AdjustStockDto, AdminBulkProductsDto, AdminCreateProductDto, AdminProductsQuery, AdminProductStatusDto, BulkVariantsDto, CreateProductDto,
  ImageVariantDto, InventoryQuery, ModerationDto, ReorderImagesDto, SellerProductsQuery, UpdateProductDto, UpdateVariantDto, VariantInputDto,
} from './dto/product.dto';
import { PublicProductsService } from './public-products.service';
import { hasInternalKey } from '../common/utils/internal-key';
import { SellerProductsService } from './seller-products.service';

@ApiTags('Products')
@Controller({ path: 'products', version: '1' })
export class PublicProductsController {
  constructor(private readonly products: PublicProductsService) {}

  @Public() @Get(':slug')
  async bySlug(@Param('slug') slug: string, @Req() req: Request, @CurrentUser() user?: AuthUser) {
    const product = await this.products.bySlug(slug);
    // Page renders by our own website server are not views; the shopper's browser reports the real view.
    if (!hasInternalKey(req)) void this.products.recordView(product.id, user?.id ?? req.ip ?? 'anon', user?.id); // fire-and-forget
    return product;
  }
}

@ApiTags('Seller / Products')
@ApiBearerAuth()
@UseGuards(SellerGuard) // approved sellers only; seller comes from the token, never the URL
@Controller({ path: 'seller', version: '1' })
export class SellerProductsController {
  constructor(private readonly products: SellerProductsService) {}

  @Get('products') list(@CurrentSeller() s: SellerContext, @Query() q: SellerProductsQuery) {
    return this.products.list(s, q);
  }

  @Post('products') create(@CurrentSeller() s: SellerContext, @Body() dto: CreateProductDto, @CurrentUser() u: AuthUser) {
    return this.products.create(s, dto, u.id);
  }

  @Get('products/:id') get(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(s, id);
  }

  @Patch('products/:id') update(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() u: AuthUser) {
    return this.products.update(s, id, dto, u.id);
  }

  @Delete('products/:id') @HttpCode(204)
  archive(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.products.archive(s, id, u.id);
  }

  @Post('products/:id/variants') addVariant(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VariantInputDto, @CurrentUser() u: AuthUser) {
    return this.products.addVariant(s, id, dto, u.id);
  }

  @Patch('variants/:variantId') updateVariant(@CurrentSeller() s: SellerContext, @Param('variantId', ParseUUIDPipe) vid: string, @Body() dto: UpdateVariantDto, @CurrentUser() u: AuthUser) {
    return this.products.updateVariant(s, vid, dto, u.id);
  }

  @HttpCode(200)
  @Post('variants/:variantId/stock') stock(@CurrentSeller() s: SellerContext, @Param('variantId', ParseUUIDPipe) vid: string, @Body() dto: AdjustStockDto, @CurrentUser() u: AuthUser) {
    return this.products.adjustStock(s, vid, dto, u.id);
  }

  @Get('variants/:variantId/stock') stockHistory(@CurrentSeller() s: SellerContext, @Param('variantId', ParseUUIDPipe) vid: string) {
    return this.products.stockHistory(s, vid);
  }

  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'variantId', required: false })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Post('products/:id/images')
  addImage(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser, @Query('variantId') variantId?: string) {
    return this.products.addImage(s, id, file, variantId, u.id);
  }

  @Put('products/:id/images/order') @HttpCode(204)
  reorder(@CurrentSeller() s: SellerContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderImagesDto, @CurrentUser() u: AuthUser) {
    return this.products.reorderImages(s, id, dto, u.id);
  }

  @Patch('images/:imageId')
  setImageVariant(@CurrentSeller() s: SellerContext, @Param('imageId', ParseUUIDPipe) imageId: string, @Body() dto: ImageVariantDto, @CurrentUser() u: AuthUser) {
    return this.products.setImageVariant(s, imageId, dto.variantId ?? null, u.id);
  }

  @Delete('images/:imageId') @HttpCode(204)
  removeImage(@CurrentSeller() s: SellerContext, @Param('imageId', ParseUUIDPipe) imageId: string, @CurrentUser() u: AuthUser) {
    return this.products.removeImage(s, imageId, u.id);
  }
}

@ApiTags('Admin / Products')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminProductsController {
  constructor(
    private readonly admin: AdminProductsService,
    private readonly catalog: AdminCatalogService,
    private readonly csv: CatalogCsvService,
  ) {}

  // ---- lists and exports (static paths before :id)

  @RequirePermissions('products.read') @Get('products')
  list(@Query() q: AdminProductsQuery) { return this.catalog.list(q); }

  @RequirePermissions('products.read') @Get('products/export.csv')
  async export(@Res() res: Response, @Query('house') house?: string) {
    const buf = await this.csv.export(house !== 'false');
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="fastmovex-products-${new Date().toISOString().slice(0, 10)}.csv"` }).send(buf);
  }

  @RequirePermissions('products.read') @Get('products/import-template.csv')
  template(@Res() res: Response) {
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="fastmovex-products-template.csv"' }).send(this.csv.template());
  }

  @RequirePermissions('products.manage')
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'dryRun', required: false, description: 'true = validate and preview only' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @HttpCode(200) @Post('products/import')
  import(@UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun: string | undefined, @CurrentUser() u: AuthUser) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a CSV file in the "file" field');
    if (file.buffer.includes(0)) throw new BadRequestException('This is not a text (CSV) file');
    return this.csv.import(file.buffer, dryRun === 'true' || dryRun === '1', u.id);
  }

  @RequirePermissions('products.manage') @HttpCode(200) @Post('products/bulk')
  bulk(@Body() dto: AdminBulkProductsDto, @CurrentUser() u: AuthUser) { return this.catalog.bulk(dto, u.id); }

  @RequirePermissions('products.manage') @Post('products')
  create(@Body() dto: AdminCreateProductDto, @CurrentUser() u: AuthUser) { return this.catalog.create(dto, u.id); }

  // ---- one product

  @RequirePermissions('products.read') @Get('products/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.get(id); }

  @RequirePermissions('products.manage') @Patch('products/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() u: AuthUser) { return this.catalog.update(id, dto, u.id); }

  @RequirePermissions('products.manage') @HttpCode(200) @Post('products/:id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminProductStatusDto, @CurrentUser() u: AuthUser) { return this.catalog.setStatus(id, dto.status, u.id); }

  @RequirePermissions('products.manage') @Post('products/:id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.catalog.duplicate(id, u.id); }

  @RequirePermissions('products.manage') @Post('products/:id/variants')
  addVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VariantInputDto, @CurrentUser() u: AuthUser) { return this.catalog.addVariant(id, dto, u.id); }

  @RequirePermissions('products.manage')
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'variantId', required: false })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Post('products/:id/images')
  addImage(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser, @Query('variantId') variantId?: string) {
    return this.catalog.addImage(id, file, variantId, u.id);
  }

  @RequirePermissions('products.manage') @Put('products/:id/images/order') @HttpCode(204)
  reorder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderImagesDto, @CurrentUser() u: AuthUser) { return this.catalog.reorderImages(id, dto.imageIds, u.id); }

  @RequirePermissions('products.manage') @Patch('images/:imageId')
  setImageVariant(@Param('imageId', ParseUUIDPipe) imageId: string, @Body() dto: ImageVariantDto, @CurrentUser() u: AuthUser) { return this.catalog.setImageVariant(imageId, dto.variantId ?? null, u.id); }

  @RequirePermissions('products.manage') @Delete('images/:imageId') @HttpCode(204)
  removeImage(@Param('imageId', ParseUUIDPipe) imageId: string, @CurrentUser() u: AuthUser) { return this.catalog.removeImage(imageId, u.id); }

  // ---- moderation of marketplace sellers' products

  @RequirePermissions('products.moderate') @HttpCode(200) @Post('products/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.admin.approve(id, u.id); }

  @RequirePermissions('products.moderate') @HttpCode(200) @Post('products/:id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationDto, @CurrentUser() u: AuthUser) { return this.admin.reject(id, dto.reason, u.id); }

  @RequirePermissions('featured.manage') @HttpCode(200) @Post('products/:id/feature')
  feature(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.admin.setFeatured(id, true, u.id); }

  @RequirePermissions('featured.manage') @HttpCode(200) @Post('products/:id/unfeature')
  unfeature(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.admin.setFeatured(id, false, u.id); }

  // ---- variants and inventory

  @RequirePermissions('products.manage') @Patch('variants/:variantId')
  updateVariant(@Param('variantId', ParseUUIDPipe) vid: string, @Body() dto: UpdateVariantDto, @CurrentUser() u: AuthUser) { return this.catalog.updateVariant(vid, dto, u.id); }

  @RequirePermissions('inventory.manage') @HttpCode(200) @Post('variants/:variantId/stock')
  adjustStock(@Param('variantId', ParseUUIDPipe) vid: string, @Body() dto: AdjustStockDto, @CurrentUser() u: AuthUser) { return this.catalog.adjustStock(vid, dto, u); }

  @RequirePermissions('products.read') @Get('variants/:variantId/stock')
  stockHistory(@Param('variantId', ParseUUIDPipe) vid: string) { return this.catalog.stockHistory(vid); }

  @RequirePermissions('products.read') @Get('inventory')
  inventory(@Query() q: InventoryQuery) { return this.catalog.inventory(q); }

  /** Spreadsheet-style edits: prices need products.manage, stock needs inventory.manage. */
  @HttpCode(200) @Post('inventory/bulk')
  bulkVariants(@Body() dto: BulkVariantsDto, @CurrentUser() u: AuthUser) {
    const prices = dto.changes.some((c) => c.priceMinor !== undefined || c.compareAtMinor !== undefined);
    const stock = dto.changes.some((c) => c.onHand !== undefined);
    if ((prices && !u.permissions.includes('products.manage')) || (stock && !u.permissions.includes('inventory.manage'))) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return this.catalog.bulkVariants(dto, u);
  }
}
