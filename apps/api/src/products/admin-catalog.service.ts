import { assertWriteOffAllowed } from '../inventory/write-off';
import { AuthUser } from '../common/auth-user';
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { SellerContext } from '../common/auth-user';
import { toMinor } from '../common/utils/money';
import { uniqueSlug } from '../common/utils/slug';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  AdjustStockDto, AdminBulkProductsDto, AdminCreateProductDto, AdminProductsQuery, BulkVariantsDto, InventoryQuery, UpdateProductDto,
  UpdateVariantDto, VariantInputDto,
} from './dto/product.dto';
import { assertCompareAt, stockAfter } from './product-rules';
import { SellerProductsService } from './seller-products.service';
import { StorefrontService } from '../common/storefront.service';
import { CacheService } from '../cache/cache.service';

type Sort = NonNullable<AdminProductsQuery['sort']>;
const ORDER: Record<Sort, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  updated: [{ updatedAt: 'desc' }, { id: 'desc' }],
  title: [{ title: 'asc' }, { id: 'asc' }],
  price_asc: [{ minPriceMinor: 'asc' }, { id: 'asc' }],
  price_desc: [{ minPriceMinor: 'desc' }, { id: 'desc' }],
  best_selling: [{ soldCount: 'desc' }, { id: 'desc' }],
};

/**
 * Catalogue management for staff (the admin dashboard). FastMoveX sells from its own "house" store; staff can also
 * manage marketplace sellers' products. All writes go through the same product rules as sellers use, with audit logs.
 */
@Injectable()
export class AdminCatalogService {
  private houseCache: SellerContext | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly products: SellerProductsService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  /** Product page data is cached by the API (10 s) and the website (60 s): drop both after a staff edit. */
  private async changed(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, select: { slug: true } });
    if (!p) return;
    await this.cache?.del(`product:v1:${p.slug}`);
    this.storefront?.refresh(`product:${p.slug}`, 'home', 'search', 'offers');
  }

  // ------------------------------------------------------------------ scope

  async house(): Promise<SellerContext & { storeId: string }> {
    const s = await this.prisma.seller.findFirst({ where: { isHouse: true }, select: { id: true, status: true, countryCode: true, store: { select: { id: true } } } });
    if (!s?.store) throw new ConflictException('The FastMoveX store is missing. Run the base seed (npm run db:seed).');
    this.houseCache = { id: s.id, status: s.status, countryCode: s.countryCode };
    return { ...this.houseCache, storeId: s.store.id };
  }

  private async sellerOfStore(storeId: string): Promise<SellerContext> {
    const st = await this.prisma.store.findUnique({ where: { id: storeId }, select: { seller: { select: { id: true, status: true, countryCode: true } } } });
    if (!st) throw new NotFoundException('Store not found');
    return st.seller;
  }

  private async sellerOfProduct(productId: string): Promise<SellerContext> {
    const p = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { store: { select: { seller: { select: { id: true, status: true, countryCode: true } } } } } });
    if (!p) throw new NotFoundException('Product not found');
    return p.store.seller;
  }

  private async sellerOfVariant(variantId: string): Promise<SellerContext> {
    const v = await this.prisma.productVariant.findUnique({ where: { id: variantId }, select: { product: { select: { deletedAt: true, store: { select: { seller: { select: { id: true, status: true, countryCode: true } } } } } } } });
    if (!v || v.product.deletedAt) throw new NotFoundException('Variant not found');
    return v.product.store.seller;
  }

  // ------------------------------------------------------------------ reads

  async list(q: AdminProductsQuery) {
    const limit = q.limit ?? 25;
    const page = q.page ?? 1;
    const where: Prisma.ProductWhereInput = q.stock ? { AND: [this.where(q), { id: { in: await this.stockFilterIds(q.stock) } }] } : this.where(q);
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: ORDER[q.sort ?? 'newest'],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, title: true, titleAr: true, slug: true, status: true, minPriceMinor: true, soldCount: true, isFeatured: true,
          moderationNote: true, createdAt: true, updatedAt: true, tags: true,
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          store: { select: { id: true, name: true, seller: { select: { id: true, status: true, isHouse: true } } } },
          images: { select: { fileKey: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: {
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { sku: true, currencyCode: true, inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } } },
          },
        },
      }),
    ]);
    return {
      total, page, pageCount: Math.max(1, Math.ceil(total / limit)),
      items: rows.map(({ images, variants, store, ...p }) => {
        const available = variants.reduce((s, v) => s + Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)), 0);
        return {
          ...p,
          minPriceMinor: p.minPriceMinor.toString(),
          currencyCode: variants[0]?.currencyCode ?? null,
          imageUrl: this.storage.publicUrl(images[0]?.fileKey),
          store: { id: store.id, name: store.name, isHouse: store.seller.isHouse, sellerStatus: store.seller.status },
          variantCount: variants.length,
          skus: variants.slice(0, 3).map((v) => v.sku),
          available,
          lowStock: variants.some((v) => v.inventory && v.inventory.onHand - v.inventory.reserved <= v.inventory.lowStockThreshold),
          outOfStock: available === 0,
        };
      }),
    };
  }

  private where(q: AdminProductsQuery): Prisma.ProductWhereInput {
    const term = q.q?.trim();
    return {
      deletedAt: q.status === 'ARCHIVED' ? undefined : null,
      status: q.status,
      categoryId: q.categoryId,
      brandId: q.brandId,
      isFeatured: q.featured,
      store: q.sellerId ? { sellerId: q.sellerId } : q.house !== undefined ? { seller: { isHouse: q.house } } : undefined,
      ...(term && {
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { titleAr: { contains: term, mode: 'insensitive' } },
          { tags: { has: term.toLowerCase() } },
          { variants: { some: { OR: [{ sku: { contains: term, mode: 'insensitive' } }, { barcode: term }] } } },
        ],
      }),
    };
  }

  /** Products whose active variants are low / out of stock. Raw SQL: compares two columns (onHand − reserved ≤ threshold). */
  async stockFilterIds(kind: 'low' | 'out'): Promise<string[]> {
    const rows = kind === 'out'
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT v."productId" AS id FROM "ProductVariant" v JOIN "Inventory" i ON i."variantId" = v.id
          WHERE v."isActive" GROUP BY v."productId" HAVING SUM(GREATEST(i."onHand" - i."reserved", 0)) = 0`
      : await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT DISTINCT v."productId" AS id FROM "ProductVariant" v JOIN "Inventory" i ON i."variantId" = v.id
          WHERE v."isActive" AND i."onHand" - i."reserved" <= i."lowStockThreshold"`;
    return rows.map((r) => r.id);
  }

  async get(id: string) {
    const p = await this.prisma.product.findFirst({
      where: { id },
      include: {
        category: { select: { id: true, name: true, nameAr: true, path: true } },
        brand: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, slug: true, seller: { select: { id: true, status: true, isHouse: true } } } },
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { createdAt: 'asc' }, include: { inventory: true } },
      },
    });
    if (!p) throw new NotFoundException('Product not found');
    return {
      ...p,
      images: p.images.map((i) => ({ ...i, url: this.storage.publicUrl(i.fileKey) })),
      store: { id: p.store.id, name: p.store.name, slug: p.store.slug, isHouse: p.store.seller.isHouse, sellerStatus: p.store.seller.status },
    };
  }

  // ------------------------------------------------------------------ writes

  async create(dto: AdminCreateProductDto, actorId: string) {
    const seller = dto.storeId ? await this.sellerOfStore(dto.storeId) : await this.house();
    const { storeId: _s, status, ...rest } = dto;
    const created = await this.products.create(seller, { ...rest, submitForReview: false }, actorId);
    if (status === 'ACTIVE') await this.setStatus(created.id, 'ACTIVE', actorId);
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const seller = await this.sellerOfProduct(id);
    const current = await this.prisma.product.findUniqueOrThrow({ where: { id }, select: { status: true } });
    // Staff edits never send a product back to review; the status is changed explicitly with setStatus().
    await this.products.update(seller, id, { ...dto, submitForReview: undefined }, actorId);
    await this.prisma.product.update({ where: { id }, data: { status: current.status } });
    await this.changed(id);
    return this.get(id);
  }

  /** Staff publish directly: a product needs a photo, an active variant and an approved store to go live. */
  async setStatus(id: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED', actorId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id },
      select: { status: true, deletedAt: true, store: { select: { isActive: true, seller: { select: { status: true } } } }, _count: { select: { images: true } }, variants: { where: { isActive: true }, select: { id: true } } },
    });
    if (!p) throw new NotFoundException('Product not found');
    if (status === 'ACTIVE') {
      if (!p._count.images) throw new BadRequestException('Add at least one photo before publishing');
      if (!p.variants.length) throw new BadRequestException('Add at least one active variant before publishing');
      if (p.store.seller.status !== 'APPROVED' || !p.store.isActive) throw new BadRequestException('The store is not approved or not active');
    }
    await this.prisma.product.update({
      where: { id },
      data: { status: status as ProductStatus, deletedAt: status === 'ARCHIVED' ? new Date() : null, moderationNote: status === 'ACTIVE' ? null : undefined },
    });
    await this.audit.log({ actorId, action: `product.status.${status.toLowerCase()}`, entityType: 'Product', entityId: id, before: { status: p.status }, after: { status } });
    await this.changed(id);
    return this.get(id);
  }

  async bulk(dto: AdminBulkProductsDto, actorId: string) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of dto.ids) {
      try {
        if (dto.action === 'feature' || dto.action === 'unfeature') {
          await this.prisma.product.update({ where: { id }, data: { isFeatured: dto.action === 'feature' } });
          await this.audit.log({ actorId, action: `product.${dto.action}`, entityType: 'Product', entityId: id });
        } else {
          await this.setStatus(id, dto.action === 'publish' ? 'ACTIVE' : dto.action === 'draft' ? 'DRAFT' : 'ARCHIVED', actorId);
        }
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), results };
  }

  /** Copies text, organisation and variants (new SKUs get a "-COPY" suffix, stock 0). Photos are not copied. */
  async duplicate(id: string, actorId: string) {
    const src = await this.prisma.product.findFirst({ where: { id }, include: { variants: { where: { isActive: true } } } });
    if (!src) throw new NotFoundException('Product not found');
    const copy = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          storeId: src.storeId, categoryId: src.categoryId, brandId: src.brandId, countryCode: src.countryCode,
          slug: uniqueSlug(`${src.title} copy`), title: `${src.title} (copy)`, titleAr: src.titleAr,
          shortDescription: src.shortDescription, shortDescriptionAr: src.shortDescriptionAr, description: src.description, descriptionAr: src.descriptionAr,
          specs: src.specs as Prisma.InputJsonValue, tags: src.tags, seoTitle: src.seoTitle, seoDescription: src.seoDescription,
          returnPolicyDays: src.returnPolicyDays, warrantyMonths: src.warrantyMonths, status: 'DRAFT', minPriceMinor: src.minPriceMinor,
        },
        select: { id: true },
      });
      for (const v of src.variants) {
        await tx.productVariant.create({
          data: {
            productId: p.id, sku: `${v.sku}-COPY`.slice(0, 64), optionValues: v.optionValues as Prisma.InputJsonValue, priceMinor: v.priceMinor,
            compareAtMinor: v.compareAtMinor, costPriceMinor: v.costPriceMinor, currencyCode: v.currencyCode, weightGrams: v.weightGrams,
            lengthMm: v.lengthMm, widthMm: v.widthMm, heightMm: v.heightMm, inventory: { create: { onHand: 0 } },
          },
        });
      }
      return p;
    });
    await this.audit.log({ actorId, action: 'product.duplicate', entityType: 'Product', entityId: copy.id, before: { from: id } });
    return this.get(copy.id);
  }

  async addVariant(productId: string, dto: VariantInputDto, actorId: string) {
    await this.products.addVariant(await this.sellerOfProduct(productId), productId, dto, actorId);
    return this.get(productId);
  }

  async updateVariant(variantId: string, dto: UpdateVariantDto, actorId: string) {
    const seller = await this.sellerOfVariant(variantId);
    const r = await this.products.updateVariant(seller, variantId, dto, actorId);
    return this.get(r.id);
  }

  async adjustStock(variantId: string, dto: AdjustStockDto, actor: AuthUser) {
    await assertWriteOffAllowed(this.prisma, actor, variantId, dto.delta);
    return this.products.adjustStock(await this.sellerOfVariant(variantId), variantId, dto, actor.id);
  }

  async stockHistory(variantId: string) {
    await this.sellerOfVariant(variantId);
    const rows = await this.prisma.inventoryMovement.findMany({ where: { variantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
    return rows.map((r) => ({ ...r, actorName: actors.find((a) => a.id === r.actorId)?.fullName ?? null }));
  }

  async addImage(productId: string, file: Express.Multer.File | undefined, variantId?: string, actorId?: string) {
    return this.products.addImage(await this.sellerOfProduct(productId), productId, file, variantId, actorId);
  }

  async reorderImages(productId: string, imageIds: string[], actorId?: string) {
    return this.products.reorderImages(await this.sellerOfProduct(productId), productId, { imageIds }, actorId);
  }

  async setImageVariant(imageId: string, variantId: string | null, actorId?: string) {
    const img = await this.prisma.productImage.findUnique({ where: { id: imageId }, select: { product: { select: { store: { select: { seller: { select: { id: true, status: true, countryCode: true } } } } } } } });
    if (!img) throw new NotFoundException('Image not found');
    return this.products.setImageVariant(img.product.store.seller, imageId, variantId, actorId);
  }

  async removeImage(imageId: string, actorId?: string) {
    const img = await this.prisma.productImage.findUnique({ where: { id: imageId }, select: { product: { select: { store: { select: { seller: { select: { id: true, status: true, countryCode: true } } } } } } } });
    if (!img) throw new NotFoundException('Image not found');
    return this.products.removeImage(img.product.store.seller, imageId, actorId);
  }

  // ------------------------------------------------------------------ inventory

  async inventory(q: InventoryQuery) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const term = q.q?.trim();
    const params: unknown[] = [];
    const conds = ['p."deletedAt" IS NULL', 'v."isActive"'];
    if (term) {
      params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, term);
      conds.push(`(p.title ILIKE $${params.length - 1} OR v.sku ILIKE $${params.length - 1} OR v.barcode = $${params.length})`);
    }
    if (q.stock === 'out') conds.push('i."onHand" - i.reserved <= 0');
    if (q.stock === 'low') conds.push('i."onHand" - i.reserved <= i."lowStockThreshold"');
    if (q.house !== undefined) { params.push(q.house); conds.push(`s."isHouse" = $${params.length}`); }
    let warehouseJoin = '';
    let warehouseCol = 'NULL::int AS "warehouseOnHand"';
    if (q.warehouseId) {
      params.push(q.warehouseId);
      const w = `$${params.length}::uuid`;
      // only the products of the seller that owns the warehouse
      conds.push(`s.id = (SELECT "sellerId" FROM "Warehouse" WHERE id = ${w})`);
      warehouseJoin = ` LEFT JOIN "WarehouseStock" ws ON ws."variantId" = v.id AND ws."warehouseId" = ${w}`;
      warehouseCol = 'coalesce(ws."onHand", 0) AS "warehouseOnHand"';
    }
    const whereSql = conds.join(' AND ');
    const from = `FROM "ProductVariant" v JOIN "Inventory" i ON i."variantId" = v.id JOIN "Product" p ON p.id = v."productId"
      JOIN "Store" st ON st.id = p."storeId" JOIN "Seller" s ON s.id = st."sellerId"${warehouseJoin}`;
    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n ${from} WHERE ${whereSql}`, ...params);
    params.push(limit, (page - 1) * limit);
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT v.id AS "variantId", v.sku, v.barcode, v."optionValues", v."priceMinor"::text AS "priceMinor", v."currencyCode",
              p.id AS "productId", p.title, p.status, st.name AS "storeName", s."isHouse",
              i."onHand", i.reserved, i."lowStockThreshold", (i."onHand" - i.reserved) AS available, i."updatedAt", ${warehouseCol},
              (SELECT coalesce(json_agg(json_build_object('code', w.code, 'onHand', x."onHand") ORDER BY w."isDefault" DESC, w.priority), '[]'::json)
                 FROM "WarehouseStock" x JOIN "Warehouse" w ON w.id = x."warehouseId" WHERE x."variantId" = v.id AND x."onHand" > 0) AS "byWarehouse"
       ${from} WHERE ${whereSql}
       ORDER BY (i."onHand" - i.reserved) ASC, p.title ASC, v.sku ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params,
    );
    const total = Number(n);
    return { total, page, pageCount: Math.max(1, Math.ceil(total / limit)), items: rows };
  }

  /** Several prices and stock counts in one go (spreadsheet-style editing). Each change is validated and audited. */
  async bulkVariants(dto: BulkVariantsDto, actor: AuthUser) {
    const actorId = actor.id;
    const results: { variantId: string; ok: boolean; error?: string }[] = [];
    for (const c of dto.changes) {
      try {
        const seller = await this.sellerOfVariant(c.variantId);
        if (c.priceMinor !== undefined || c.compareAtMinor !== undefined) {
          const v = await this.prisma.productVariant.findUniqueOrThrow({ where: { id: c.variantId }, select: { priceMinor: true, compareAtMinor: true } });
          const price = c.priceMinor !== undefined ? toMinor(c.priceMinor, 'priceMinor') : v.priceMinor;
          const cmp = c.compareAtMinor === null ? null : c.compareAtMinor !== undefined ? toMinor(c.compareAtMinor, 'compareAtMinor') : v.compareAtMinor;
          assertCompareAt(price, cmp);
          await this.products.updateVariant(seller, c.variantId, { priceMinor: c.priceMinor, compareAtMinor: c.compareAtMinor }, actorId);
        }
        if (c.onHand !== undefined) {
          const inv = await this.prisma.inventory.findUniqueOrThrow({ where: { variantId: c.variantId } });
          // a count in one warehouse, or the total (the difference then goes to the default warehouse)
          const current = dto.warehouseId
            ? (await this.prisma.warehouseStock.findUnique({ where: { warehouseId_variantId: { warehouseId: dto.warehouseId, variantId: c.variantId } } }))?.onHand ?? 0
            : inv.onHand;
          const delta = c.onHand - current;
          if (delta !== 0) {
            stockAfter(inv.onHand, inv.reserved, delta);
            await assertWriteOffAllowed(this.prisma, actor, c.variantId, delta); // a spreadsheet edit is no way around the limit
            await this.products.adjustStock(seller, c.variantId, { delta, reason: 'ADJUSTMENT', note: dto.note ?? 'Bulk update', warehouseId: dto.warehouseId }, actorId);
          }
        }
        results.push({ variantId: c.variantId, ok: true });
      } catch (e) {
        results.push({ variantId: c.variantId, ok: false, error: (e as Error).message });
      }
    }
    return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  }
}
