import { assertReasonDirection } from '../inventory/write-off';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { SellerContext } from '../common/auth-user';
import { toMinor } from '../common/utils/money';
import { assertOwnedBy } from '../common/utils/ownership';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { uniqueSlug } from '../common/utils/slug';
import { SizeChartsService } from '../size-charts/size-charts.service';
import { PrismaService } from '../prisma/prisma.service';
import { WarehousesService } from '../warehouses/warehouses';
import { validateUpload } from '../storage/file-validation';
import { StorageService } from '../storage/storage.service';
import {
  AdjustStockDto, CreateProductDto, ReorderImagesDto, SellerProductsQuery, UpdateProductDto, UpdateVariantDto, VariantInputDto,
} from './dto/product.dto';
import {
  assertCompareAt, assertDistinctOptions, assertOptionValues, assertSpecs, assertUniqueSkus, nextStatusAfterSellerEdit, stockAfter,
} from './product-rules';

const MAX_IMAGES = 10;
const MAX_VARIANTS = 100;

@Injectable()
export class SellerProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly warehouses?: WarehousesService,
    @Optional() private readonly sizeCharts?: SizeChartsService,
  ) {}

  // ----------------------------------------------------------------- products

  async create(seller: SellerContext, dto: CreateProductDto, actorId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { sellerId: seller.id }, select: { id: true } });
    await this.assertCategory(dto.categoryId);
    if (dto.brandId) await this.assertBrand(dto.brandId);
    if (dto.sizeChartId) await this.sizeCharts?.assertUsable(dto.sizeChartId, store.id);
    const currencyCode = await this.currencyFor(seller.countryCode);

    assertUniqueSkus(dto.variants.map((v) => v.sku));
    const variants = dto.variants.map((v) => this.variantData(v, currencyCode));
    assertDistinctOptions(variants.map((v) => v.optionValues));

    const product = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          storeId: store.id,
          categoryId: dto.categoryId,
          brandId: dto.brandId,
          countryCode: seller.countryCode,
          slug: uniqueSlug(dto.title),
          title: dto.title,
          titleAr: dto.titleAr,
          shortDescription: dto.shortDescription,
          shortDescriptionAr: dto.shortDescriptionAr,
          description: dto.description,
          descriptionAr: dto.descriptionAr,
          specs: assertSpecs(dto.specs),
          tags: dto.tags ?? [],
          seoTitle: dto.seoTitle,
          seoDescription: dto.seoDescription,
          returnPolicyDays: dto.returnPolicyDays,
          warrantyMonths: dto.warrantyMonths,
          sizeChartId: dto.sizeChartId ?? null,
          tracksExpiry: dto.tracksExpiry ?? false,
          status: 'DRAFT', // images are uploaded after create, then seller submits via PATCH { submitForReview: true }
          minPriceMinor: variants.reduce((m, v) => (v.priceMinor < m ? v.priceMinor : m), variants[0].priceMinor),
        },
        select: { id: true },
      });
      for (const v of variants) await this.createVariant(tx, p.id, v, actorId, seller.id);
      return p;
    });

    await this.audit.log({ actorId, action: 'product.create', entityType: 'Product', entityId: product.id });
    return this.get(seller, product.id);
  }

  async list(seller: SellerContext, q: SellerProductsQuery) {
    const limit = q.limit ?? 20;
    const rows = await this.prisma.product.findMany({
      where: {
        store: { sellerId: seller.id },
        deletedAt: null,
        status: q.status,
        ...(q.q && { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { variants: { some: { sku: { contains: q.q, mode: 'insensitive' } } } }] }),
        ...afterCursor(decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, title: true, slug: true, status: true, minPriceMinor: true, soldCount: true, ratingAvg: true, createdAt: true, moderationNote: true,
        category: { select: { name: true } },
        images: { select: { fileKey: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
        variants: { where: { isActive: true }, select: { inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } } } },
      },
    });
    const page = toPage(rows, limit);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(({ images, variants, ...p }) => {
        const available = variants.reduce((s, v) => s + ((v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)), 0);
        const lowStock = variants.some((v) => v.inventory && v.inventory.onHand - v.inventory.reserved <= v.inventory.lowStockThreshold);
        return { ...p, imageUrl: this.storage.publicUrl(images[0]?.fileKey), variantCount: variants.length, availableStock: available, lowStock };
      }),
    };
  }

  async get(seller: SellerContext, id: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null, store: { sellerId: seller.id } }, // ownership is part of the query
      include: {
        category: { select: { id: true, name: true, path: true } },
        brand: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { createdAt: 'asc' }, include: { inventory: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return { ...p, images: p.images.map((i) => ({ ...i, url: this.storage.publicUrl(i.fileKey) })) };
  }

  async update(seller: SellerContext, id: string, dto: UpdateProductDto, actorId: string) {
    const p = await this.owned(seller.id, id);
    const status = nextStatusAfterSellerEdit(p.status, dto.submitForReview);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    if (dto.brandId) await this.assertBrand(dto.brandId);
    if (dto.sizeChartId) await this.sizeCharts?.assertUsable(dto.sizeChartId, p.storeId);
    if (status === 'PENDING_REVIEW' && p.status !== 'PENDING_REVIEW') await this.assertReadyForReview(id);

    await this.prisma.product.update({
      where: { id },
      data: {
        title: dto.title, titleAr: dto.titleAr, description: dto.description, descriptionAr: dto.descriptionAr,
        shortDescription: dto.shortDescription, shortDescriptionAr: dto.shortDescriptionAr,
        tags: dto.tags, seoTitle: dto.seoTitle, seoDescription: dto.seoDescription,
        categoryId: dto.categoryId, brandId: dto.brandId,
        specs: dto.specs === undefined ? undefined : assertSpecs(dto.specs),
        returnPolicyDays: dto.returnPolicyDays, warrantyMonths: dto.warrantyMonths, tracksExpiry: dto.tracksExpiry,
        sizeChartId: dto.sizeChartId,
        status: status as Prisma.ProductUpdateInput['status'],
        moderationNote: status === 'PENDING_REVIEW' ? null : undefined,
      },
    });
    await this.audit.log({ actorId, action: 'product.update', entityType: 'Product', entityId: id, before: { status: p.status }, after: { status, fields: Object.keys(dto) } });
    return this.get(seller, id);
  }

  /** Soft delete: order history keeps pointing at the product. */
  async archive(seller: SellerContext, id: string, actorId: string) {
    await this.owned(seller.id, id);
    await this.prisma.product.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    await this.audit.log({ actorId, action: 'product.archive', entityType: 'Product', entityId: id });
  }

  // ----------------------------------------------------------------- variants

  async addVariant(seller: SellerContext, productId: string, dto: VariantInputDto, actorId: string) {
    const p = await this.owned(seller.id, productId);
    const count = await this.prisma.productVariant.count({ where: { productId } });
    if (count >= MAX_VARIANTS) throw new BadRequestException(`Max ${MAX_VARIANTS} variants per product`);
    const data = this.variantData(dto, await this.currencyFor(p.countryCode));

    const existing = await this.prisma.productVariant.findMany({ where: { productId }, select: { optionValues: true } });
    assertDistinctOptions([...existing.map((e) => e.optionValues as Record<string, string>), data.optionValues]);

    await this.skuGuard(() => this.prisma.$transaction((tx) => this.createVariant(tx, productId, data, actorId, seller.id)));
    await this.refreshMinPrice(productId);
    await this.audit.log({ actorId, action: 'variant.create', entityType: 'Product', entityId: productId, after: { sku: data.sku, priceMinor: data.priceMinor.toString(), options: data.optionValues } as Prisma.InputJsonValue });
    return this.get(seller, productId);
  }

  async updateVariant(seller: SellerContext, variantId: string, dto: UpdateVariantDto, actorId: string) {
    const v = await this.ownedVariant(seller.id, variantId);
    const price = dto.priceMinor !== undefined ? toMinor(dto.priceMinor, 'priceMinor') : v.priceMinor;
    const compareAt =
      dto.compareAtMinor === null ? null : dto.compareAtMinor !== undefined ? toMinor(dto.compareAtMinor, 'compareAtMinor') : v.compareAtMinor;
    assertCompareAt(price, compareAt);

    await this.skuGuard(() => this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        priceMinor: price, compareAtMinor: compareAt, isActive: dto.isActive, weightGrams: dto.weightGrams,
        optionValues: dto.optionValues === undefined ? undefined : assertOptionValues(dto.optionValues),
        sku: dto.sku, barcode: dto.barcode,
        costPriceMinor: dto.costPriceMinor === null ? null : dto.costPriceMinor !== undefined ? toMinor(dto.costPriceMinor, 'costPriceMinor') : undefined,
        lengthMm: dto.lengthMm, widthMm: dto.widthMm, heightMm: dto.heightMm,
      },
    }));
    await this.refreshMinPrice(v.productId);
    if (price < v.priceMinor) this.events?.emit(EVENTS.PRICE_CHANGED, { id: v.productId });
    if (price !== v.priceMinor) {
      // Price history matters for disputes and for price-drop notifications later
      await this.audit.log({ actorId, action: 'variant.price_change', entityType: 'ProductVariant', entityId: variantId, before: { priceMinor: v.priceMinor.toString() }, after: { priceMinor: price.toString() } });
    }
    // everything else that changed (on/off, SKU, barcode, cost, options, size): which fields, not a price record
    const other = (['isActive', 'sku', 'barcode', 'costPriceMinor', 'optionValues', 'weightGrams', 'lengthMm', 'widthMm', 'heightMm', 'compareAtMinor'] as const).filter((k) => dto[k] !== undefined);
    if (other.length) await this.audit.log({ actorId, action: 'variant.update', entityType: 'ProductVariant', entityId: variantId, after: { fields: other, ...(dto.isActive !== undefined && { isActive: dto.isActive }) } });
    return this.get(seller, v.productId);
  }

  /**
   * Adds or removes units in one warehouse (the seller's default when none is named). Optimistic locking on the
   * product's total: two staff editing stock at once cannot silently overwrite each other.
   */
  async adjustStock(seller: SellerContext, variantId: string, dto: AdjustStockDto, actorId: string) {
    await this.ownedVariant(seller.id, variantId);
    if (dto.delta === 0 && dto.lowStockThreshold === undefined) throw new BadRequestException('Nothing to change: give a quantity or a low-stock alert level');
    if (dto.delta !== 0) assertReasonDirection(dto.reason, dto.delta);
    const warehouseId = await this.stockPlace().ownWarehouse(this.prisma, seller.id, dto.warehouseId);
    // dated stock: a restock of a product that tracks expiry says which date the units carry
    const tracked = dto.delta > 0 && !!(await this.prisma.productVariant.findUnique({ where: { id: variantId }, select: { product: { select: { tracksExpiry: true } } } }))?.product?.tracksExpiry;
    if (tracked && dto.delta > 0 && dto.reason === 'RESTOCK' && !dto.expiresOn) throw new BadRequestException({ message: 'This product tracks expiry: enter the expiry date of the units you are adding', reason: 'EXPIRY_REQUIRED' });
    const lot = dto.delta > 0 && dto.expiresOn ? { lotCode: dto.lotCode?.trim() || '', expiresOn: new Date(`${dto.expiresOn}T00:00:00Z`) } : undefined;
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.inventory.findUniqueOrThrow({ where: { variantId } });
      stockAfter(inv.onHand, inv.reserved, dto.delta); // the shop never ends up promising more than it has
      const res = await tx.inventory.updateMany({
        where: { id: inv.id, version: inv.version },
        data: { version: { increment: 1 }, lowStockThreshold: dto.lowStockThreshold },
      });
      if (res.count !== 1) throw new ConflictException('Stock was changed by someone else. Refresh and try again.');
      // An alert-level change alone moves no stock, so it leaves no movement row (the audit entry below records it).
      if (dto.delta !== 0) {
        await this.stockPlace().move(tx, { warehouseId, variantId, delta: dto.delta, reason: dto.reason, refType: 'manual', actorId, note: dto.note, lot, lotId: dto.delta < 0 ? dto.lotId : undefined });
      }
      const after = await tx.inventory.findUniqueOrThrow({ where: { variantId }, select: { onHand: true, reserved: true } });
      return { variantId, warehouseId, onHand: after.onHand, reserved: after.reserved, available: after.onHand - after.reserved, wasSoldOut: inv.onHand - inv.reserved <= 0 };
    }).then(async ({ wasSoldOut, ...r }) => {
      if (wasSoldOut && r.available > 0) this.events?.emit(EVENTS.VARIANT_RESTOCKED, { id: variantId });
      await this.audit.log({ actorId, action: 'inventory.adjust', entityType: 'ProductVariant', entityId: variantId, after: { delta: dto.delta, reason: dto.delta ? dto.reason : null, warehouseId, lowStockThreshold: dto.lowStockThreshold ?? null, onHand: r.onHand } });
      return r;
    });
  }

  async stockHistory(seller: SellerContext, variantId: string) {
    await this.ownedVariant(seller.id, variantId);
    return this.prisma.inventoryMovement.findMany({ where: { variantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  // ------------------------------------------------------------------ images

  async addImage(seller: SellerContext, productId: string, file: Express.Multer.File | undefined, variantId?: string, actorId?: string) {
    await this.owned(seller.id, productId);
    const f = validateUpload(file, 'image');
    const count = await this.prisma.productImage.count({ where: { productId } });
    if (count >= MAX_IMAGES) throw new BadRequestException(`Max ${MAX_IMAGES} images per product`);
    if (variantId) {
      const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId }, select: { id: true } });
      if (!v) throw new BadRequestException('Variant does not belong to this product');
    }
    const key = `products/${productId}/${randomUUID()}.${f.ext}`;
    await this.storage.put('public', key, f.buffer, f.mime);
    const img = await this.prisma.productImage.create({ data: { productId, variantId, fileKey: key, sortOrder: count } });
    await this.audit.log({ actorId: actorId ?? null, action: 'product.image_add', entityType: 'Product', entityId: productId, after: { imageId: img.id, variantId: variantId ?? null } });
    return { ...img, url: this.storage.publicUrl(key) };
  }

  async removeImage(seller: SellerContext, imageId: string, actorId?: string) {
    const img = await this.prisma.productImage.findUnique({ where: { id: imageId }, select: { id: true, fileKey: true, productId: true, product: { select: { store: { select: { sellerId: true } } } } } });
    assertOwnedBy(img && { sellerId: img.product.store.sellerId }, seller.id, 'Image');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.storage.delete('public', img!.fileKey).catch(() => undefined);
    await this.audit.log({ actorId: actorId ?? null, action: 'product.image_remove', entityType: 'Product', entityId: img!.productId, before: { imageId, fileKey: img!.fileKey } });
  }

  /** Link a photo to an option value (the colour it shows) or to none; the shop then shows it on that colour's card. */
  async setImageVariant(seller: SellerContext, imageId: string, variantId: string | null, actorId?: string) {
    const img = await this.prisma.productImage.findUnique({ where: { id: imageId }, select: { id: true, productId: true, product: { select: { store: { select: { sellerId: true } } } } } });
    assertOwnedBy(img && { sellerId: img.product.store.sellerId }, seller.id, 'Image');
    if (variantId) {
      const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId: img!.productId }, select: { id: true } });
      if (!v) throw new BadRequestException('Variant does not belong to this product');
    }
    const updated = await this.prisma.productImage.update({ where: { id: imageId }, data: { variantId } });
    await this.audit.log({ actorId: actorId ?? null, action: 'product.image_variant', entityType: 'Product', entityId: img!.productId, after: { imageId, variantId } });
    return { ...updated, url: this.storage.publicUrl(updated.fileKey) };
  }

  async reorderImages(seller: SellerContext, productId: string, dto: ReorderImagesDto, actorId?: string) {
    await this.owned(seller.id, productId);
    const imgs = await this.prisma.productImage.findMany({ where: { productId }, select: { id: true } });
    const ids = new Set(imgs.map((i) => i.id));
    if (dto.imageIds.length !== ids.size || !dto.imageIds.every((id) => ids.has(id))) {
      throw new BadRequestException('Send every image id of this product exactly once');
    }
    await this.prisma.$transaction(dto.imageIds.map((id, i) => this.prisma.productImage.update({ where: { id }, data: { sortOrder: i } })));
    await this.audit.log({ actorId: actorId ?? null, action: 'product.images_reorder', entityType: 'Product', entityId: productId, after: { imageIds: dto.imageIds } });
  }

  // ----------------------------------------------------------------- helpers

  private async owned(sellerId: string, id: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null, store: { sellerId } },
      select: { id: true, status: true, countryCode: true, storeId: true },
    });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  private async ownedVariant(sellerId: string, variantId: string) {
    const v = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, productId: true, priceMinor: true, compareAtMinor: true, product: { select: { deletedAt: true, store: { select: { sellerId: true } } } } },
    });
    assertOwnedBy(v && !v.product.deletedAt ? { sellerId: v.product.store.sellerId } : null, sellerId, 'Variant');
    return v!;
  }

  private variantData(v: VariantInputDto, currencyCode: string) {
    const priceMinor = toMinor(v.priceMinor, 'priceMinor');
    const compareAtMinor = v.compareAtMinor ? toMinor(v.compareAtMinor, 'compareAtMinor') : null;
    assertCompareAt(priceMinor, compareAtMinor);
    return {
      sku: v.sku, optionValues: assertOptionValues(v.optionValues), priceMinor, compareAtMinor, currencyCode,
      weightGrams: v.weightGrams, initialStock: v.initialStock ?? 0,
      barcode: v.barcode, costPriceMinor: v.costPriceMinor ? toMinor(v.costPriceMinor, 'costPriceMinor') : null,
      lengthMm: v.lengthMm, widthMm: v.widthMm, heightMm: v.heightMm,
    };
  }

  private async createVariant(tx: Prisma.TransactionClient, productId: string, v: ReturnType<SellerProductsService['variantData']>, actorId: string, sellerId: string) {
    const { initialStock, ...data } = v;
    const created = await tx.productVariant.create({
      data: { ...data, productId, inventory: { create: {} } }, // the total follows the warehouses
      select: { id: true },
    });
    if (initialStock > 0) {
      const warehouseId = await this.stockPlace().defaultFor(tx, sellerId);
      await this.stockPlace().move(tx, { warehouseId, variantId: created.id, delta: initialStock, reason: 'RESTOCK', refType: 'initial', actorId });
    }
  }

  private stockPlace(): WarehousesService {
    if (!this.warehouses) throw new Error('WarehousesService is not available');
    return this.warehouses;
  }

  private async refreshMinPrice(productId: string) {
    const agg = await this.prisma.productVariant.aggregate({ where: { productId, isActive: true }, _min: { priceMinor: true } });
    await this.prisma.product.update({ where: { id: productId }, data: { minPriceMinor: agg._min.priceMinor ?? 0n } });
  }

  private async assertReadyForReview(productId: string) {
    const [images, variants] = await Promise.all([
      this.prisma.productImage.count({ where: { productId } }),
      this.prisma.productVariant.count({ where: { productId, isActive: true } }),
    ]);
    if (!images) throw new BadRequestException('Add at least one product image before submitting for review');
    if (!variants) throw new BadRequestException('Add at least one active variant before submitting for review');
  }

  private async assertCategory(id: string) {
    const c = await this.prisma.category.findUnique({ where: { id }, select: { isActive: true } });
    if (!c?.isActive) throw new BadRequestException('Category not found or inactive');
  }

  private async assertBrand(id: string) {
    if (!(await this.prisma.brand.findUnique({ where: { id }, select: { id: true } }))) throw new BadRequestException('Brand not found');
  }

  private async currencyFor(countryCode: string) {
    const c = await this.prisma.country.findUniqueOrThrow({ where: { code: countryCode }, select: { currencyCode: true } });
    return c.currencyCode;
  }

  private async skuGuard<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('This SKU already exists on this product');
      throw err;
    }
  }
}
