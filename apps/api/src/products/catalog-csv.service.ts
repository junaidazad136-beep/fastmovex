import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../common/utils/slug';
import { toCsv } from '../analytics/export.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCatalogService } from './admin-catalog.service';
import { assertCompareAt, assertOptionValues } from './product-rules';
import { SellerProductsService } from './seller-products.service';

/** One row per variant. Prices are in currency units ("79.00"), as a person types them in a spreadsheet. */
export const CSV_COLUMNS = [
  'handle', 'title', 'title_ar', 'short_description', 'short_description_ar', 'description', 'description_ar',
  'category', 'brand', 'tags', 'status', 'sku', 'barcode',
  'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value',
  'price', 'compare_at_price', 'cost_price', 'stock', 'low_stock_threshold', 'weight_g',
  'return_days', 'warranty_months', 'seo_title', 'seo_description',
] as const;
type Col = (typeof CSV_COLUMNS)[number];
type Row = Partial<Record<Col, string>> & { __line: number };

export const MAX_IMPORT_ROWS = 5000;
const SKU = /^[A-Za-z0-9._-]{1,64}$/;

export interface ImportIssue { line: number; handle?: string; sku?: string; message: string }
export interface ImportReport {
  dryRun: boolean;
  rows: number;
  products: { created: number; updated: number };
  variants: { created: number; updated: number };
  stockChanges: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

/** "79", "79.5", "1,299.00" → minor units (bigint). Returns null for an empty cell, throws a message for bad input. */
export function decimalToMinorStrict(input: string | undefined, minorUnits: number, field: string): bigint | null {
  const s = (input ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  if (!/^\d{1,11}(\.\d+)?$/.test(s)) throw new Error(`${field}: "${input}" is not a valid amount`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > minorUnits) throw new Error(`${field}: at most ${minorUnits} decimals`);
  return BigInt(whole) * 10n ** BigInt(minorUnits) + BigInt(frac.padEnd(minorUnits, '0') || '0');
}

export function minorToDecimal(minor: bigint | null | undefined, minorUnits: number): string {
  if (minor === null || minor === undefined) return '';
  const base = 10n ** BigInt(minorUnits);
  return `${minor / base}${minorUnits ? `.${(minor % base).toString().padStart(minorUnits, '0')}` : ''}`;
}

/** Undo the spreadsheet-injection guard our own export adds ("'=x" → "=x"). */
function clean(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function intCell(v: string | undefined, field: string, min: number, max: number): number | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  if (!/^-?\d+$/.test(s)) throw new Error(`${field}: "${v}" is not a whole number`);
  const n = Number(s);
  if (n < min || n > max) throw new Error(`${field}: must be between ${min} and ${max}`);
  return n;
}

function options(r: Row): Record<string, string> {
  const o: Record<string, string> = {};
  for (const i of [1, 2, 3] as const) {
    const name = r[`option${i}_name`]?.trim();
    const value = r[`option${i}_value`]?.trim();
    if (name && value) o[name] = value;
    else if (name || value) throw new Error(`option${i}: give both a name and a value`);
  }
  return assertOptionValues(o);
}

@Injectable()
export class CatalogCsvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly admin: AdminCatalogService,
    private readonly products: SellerProductsService,
  ) {}

  // --------------------------------------------------------------- export

  async export(house = true): Promise<Buffer> {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, store: { seller: { isHouse: house } } },
      orderBy: { createdAt: 'asc' },
      take: 50_000,
      include: {
        category: { select: { slug: true } }, brand: { select: { name: true } },
        variants: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, include: { inventory: true } },
      },
    });
    const currency = await this.prisma.currency.findMany({ select: { code: true, minorUnits: true } });
    const mu = (code: string) => currency.find((c) => c.code === code)?.minorUnits ?? 2;
    const rows: (string | number | null)[][] = [];
    for (const p of products) {
      p.variants.forEach((v, i) => {
        const opts = Object.entries((v.optionValues ?? {}) as Record<string, string>);
        const first = i === 0; // product-level columns only on the first row, like most commerce exports
        const m = mu(v.currencyCode);
        rows.push([
          p.slug, first ? p.title : '', first ? p.titleAr : '', first ? p.shortDescription : '', first ? p.shortDescriptionAr : '',
          first ? p.description : '', first ? p.descriptionAr : '', first ? p.category.slug : '', first ? (p.brand?.name ?? '') : '',
          first ? p.tags.join(', ') : '', first ? p.status.toLowerCase() : '', v.sku, v.barcode,
          opts[0]?.[0] ?? '', opts[0]?.[1] ?? '', opts[1]?.[0] ?? '', opts[1]?.[1] ?? '', opts[2]?.[0] ?? '', opts[2]?.[1] ?? '',
          minorToDecimal(v.priceMinor, m), minorToDecimal(v.compareAtMinor, m), minorToDecimal(v.costPriceMinor, m),
          v.inventory?.onHand ?? 0, v.inventory?.lowStockThreshold ?? 5, v.weightGrams,
          first ? p.returnPolicyDays : null, first ? p.warrantyMonths : null, first ? p.seoTitle : '', first ? p.seoDescription : '',
        ]);
      });
    }
    return Buffer.from(toCsv({ title: 'products', columns: [...CSV_COLUMNS], rows }), 'utf8');
  }

  template(): Buffer {
    const example: (string | number | null)[][] = [
      ['desk-lamp', 'LED Desk Lamp', 'مصباح مكتب LED', 'Three brightness levels, USB-C', '', 'Warm and cool light…', '', 'home-kitchen', 'Lumen', 'lighting, study', 'draft', 'LAMP-WHT', '6291234567890', 'Colour', 'White', '', '', '', '', '89.00', '109.00', '45.00', 20, 5, 900, 14, 12, '', ''],
      ['desk-lamp', '', '', '', '', '', '', '', '', '', '', 'LAMP-BLK', '', 'Colour', 'Black', '', '', '', '', '89.00', '', '45.00', 12, 5, 900, null, null, '', ''],
    ];
    return Buffer.from(toCsv({ title: 'products', columns: [...CSV_COLUMNS], rows: example }), 'utf8');
  }

  // --------------------------------------------------------------- import

  parse(buffer: Buffer): Row[] {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, { columns: (h: string[]) => h.map((x) => x.replace(/^﻿/, '').trim().toLowerCase()), skip_empty_lines: true, bom: true, relax_column_count: true, trim: false });
    } catch (e) {
      throw new BadRequestException(`The file is not a valid CSV: ${(e as Error).message}`);
    }
    if (!records.length) throw new BadRequestException('The file has no rows');
    if (records.length > MAX_IMPORT_ROWS) throw new BadRequestException(`At most ${MAX_IMPORT_ROWS} rows per file — split it into smaller files`);
    const headers = Object.keys(records[0]);
    const missing = ['handle', 'sku'].filter((c) => !headers.includes(c));
    if (missing.length) throw new BadRequestException(`Missing columns: ${missing.join(', ')}. Download the template to see every column.`);
    return records.map((r, i) => {
      const row: Row = { __line: i + 2 };
      for (const c of CSV_COLUMNS) if (c in r) row[c] = clean(r[c]);
      return row;
    });
  }

  /**
   * Creates or updates products of FastMoveX's own store. Rows are grouped by `handle`; a product is matched by its handle
   * (the product slug from an export) or by any of its SKUs, so re-importing an edited export updates in place.
   * `dryRun` validates everything and reports what would change, without writing.
   */
  async import(buffer: Buffer, dryRun: boolean, actorId: string): Promise<ImportReport> {
    const rows = this.parse(buffer);
    const house = await this.admin.house();
    const { currencyCode } = await this.prisma.country.findUniqueOrThrow({ where: { code: house.countryCode }, select: { currencyCode: true } });
    const { minorUnits } = await this.prisma.currency.findUniqueOrThrow({ where: { code: currencyCode }, select: { minorUnits: true } });
    const report: ImportReport = { dryRun, rows: rows.length, products: { created: 0, updated: 0 }, variants: { created: 0, updated: 0 }, stockChanges: 0, errors: [], warnings: [] };

    const categories = new Map((await this.prisma.category.findMany({ where: { isActive: true }, select: { id: true, slug: true } })).map((c) => [c.slug, c.id]));
    const brands = new Map((await this.prisma.brand.findMany({ select: { id: true, name: true } })).map((b) => [b.name.toLowerCase(), b.id]));

    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const h = r.handle?.trim();
      if (!h) { report.errors.push({ line: r.__line, message: 'handle is required (same value on every row of one product)' }); continue; }
      groups.set(h, [...(groups.get(h) ?? []), r]);
    }

    for (const [handle, group] of groups) {
      const issue = (r: Row, message: string) => report.errors.push({ line: r.__line, handle, sku: r.sku, message });
      const first = group.find((r) => r.title) ?? group[0];
      try {
        // ---- validate rows
        const skus = new Set<string>();
        const parsed = [];
        let ok = true;
        for (const r of group) {
          try {
            const sku = (r.sku ?? '').trim();
            if (!SKU.test(sku)) throw new Error('sku: letters, numbers, . _ - only (max 64)');
            if (skus.has(sku.toUpperCase())) throw new Error(`sku ${sku} appears twice in this product`);
            skus.add(sku.toUpperCase());
            const price = decimalToMinorStrict(r.price, minorUnits, 'price');
            const compareAt = decimalToMinorStrict(r.compare_at_price, minorUnits, 'compare_at_price');
            const cost = decimalToMinorStrict(r.cost_price, minorUnits, 'cost_price');
            if (price !== null) assertCompareAt(price, compareAt);
            const barcode = r.barcode?.trim() || undefined;
            if (barcode && !/^[A-Za-z0-9-]{4,48}$/.test(barcode)) throw new Error('barcode: 4-48 letters, digits or dashes');
            parsed.push({
              r, sku, price, compareAt, cost, barcode, opts: options(r),
              stock: intCell(r.stock, 'stock', 0, 1_000_000), threshold: intCell(r.low_stock_threshold, 'low_stock_threshold', 0, 100_000),
              weight: intCell(r.weight_g, 'weight_g', 1, 1_000_000),
            });
          } catch (e) {
            ok = false;
            issue(r, (e as Error).message);
          }
        }
        if (!ok) continue;

        // ---- find the product: by handle (slug) or by any SKU in the house store
        const existing = await this.prisma.product.findFirst({
          where: { deletedAt: null, storeId: house.storeId, OR: [{ slug: handle }, { variants: { some: { sku: { in: parsed.map((p) => p.sku) } } } }] },
          select: { id: true, status: true, variants: { select: { id: true, sku: true } }, _count: { select: { images: true } } },
        });
        const categoryId = first.category ? categories.get(first.category.trim()) : undefined;
        if (first.category && !categoryId) { issue(first, `category "${first.category}" not found — use a category slug, e.g. electronics`); continue; }
        const brandName = first.brand?.trim();
        const tags = first.tags ? [...new Set(first.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : undefined;
        const status = first.status?.trim().toLowerCase();
        if (status && !['draft', 'active', 'archived'].includes(status)) { issue(first, 'status: draft, active or archived'); continue; }
        const productFields = {
          title: first.title || undefined, titleAr: first.title_ar || undefined,
          shortDescription: first.short_description || undefined, shortDescriptionAr: first.short_description_ar || undefined,
          description: first.description || undefined, descriptionAr: first.description_ar || undefined,
          tags, seoTitle: first.seo_title || undefined, seoDescription: first.seo_description || undefined,
          returnPolicyDays: intCell(first.return_days, 'return_days', 0, 90), warrantyMonths: intCell(first.warranty_months, 'warranty_months', 0, 120),
        };

        if (!existing) {
          if (!first.title || first.title.length < 3) { issue(first, 'title is required for a new product (3+ characters)'); continue; }
          if (!categoryId) { issue(first, 'category is required for a new product'); continue; }
          const missingPrice = parsed.find((p) => p.price === null);
          if (missingPrice) { issue(missingPrice.r, 'price is required for a new variant'); continue; }
          if (status === 'active') report.warnings.push({ line: first.__line, handle, message: 'New products are created as drafts: add photos in the dashboard, then publish' });
          report.products.created++;
          report.variants.created += parsed.length;
          if (dryRun) continue;
          const brandId = brandName ? await this.brandId(brandName, brands) : undefined;
          const created = await this.products.create(house, {
            ...productFields, title: first.title, categoryId, brandId, submitForReview: false,
            variants: parsed.map((p) => ({
              sku: p.sku, barcode: p.barcode, optionValues: p.opts, priceMinor: p.price!.toString(), compareAtMinor: p.compareAt?.toString(),
              costPriceMinor: p.cost?.toString(), initialStock: p.stock ?? 0, weightGrams: p.weight,
            })),
          }, actorId);
          for (const p of parsed) if (p.threshold !== undefined) await this.prisma.inventory.updateMany({ where: { variant: { productId: created.id, sku: p.sku } }, data: { lowStockThreshold: p.threshold } });
          continue;
        }

        // ---- update an existing product
        report.products.updated++;
        const bySku = new Map(existing.variants.map((v) => [v.sku.toUpperCase(), v.id]));
        for (const p of parsed) {
          if (bySku.has(p.sku.toUpperCase())) report.variants.updated++;
          else if (p.price === null) { issue(p.r, 'price is required for a new variant'); ok = false; }
          else report.variants.created++;
        }
        if (!ok) { report.products.updated--; continue; }
        if (status === 'active' && !existing._count.images) report.warnings.push({ line: first.__line, handle, message: 'Not published: the product has no photos yet' });
        if (dryRun) {
          for (const p of parsed) {
            const id = bySku.get(p.sku.toUpperCase());
            if (id && p.stock !== undefined) {
              const inv = await this.prisma.inventory.findUnique({ where: { variantId: id }, select: { onHand: true, reserved: true } });
              if (inv && p.stock !== inv.onHand) {
                if (p.stock < inv.reserved) issue(p.r, `stock ${p.stock} is below the ${inv.reserved} units reserved by open orders`);
                else report.stockChanges++;
              }
            }
          }
          continue;
        }
        const brandId = brandName ? await this.brandId(brandName, brands) : undefined;
        await this.admin.update(existing.id, { ...productFields, categoryId, brandId }, actorId);
        for (const p of parsed) {
          const id = bySku.get(p.sku.toUpperCase());
          try {
            if (!id) {
              await this.products.addVariant(house, existing.id, {
                sku: p.sku, barcode: p.barcode, optionValues: p.opts, priceMinor: p.price!.toString(), compareAtMinor: p.compareAt?.toString(),
                costPriceMinor: p.cost?.toString(), initialStock: p.stock ?? 0, weightGrams: p.weight,
              }, actorId);
              continue;
            }
            await this.products.updateVariant(house, id, {
              ...(p.price !== null && { priceMinor: p.price.toString() }),
              ...(p.r.compare_at_price !== undefined && { compareAtMinor: p.compareAt === null ? null : p.compareAt.toString() }),
              ...(p.cost !== null && { costPriceMinor: p.cost.toString() }),
              ...(p.barcode && { barcode: p.barcode }),
              ...(Object.keys(p.opts).length && { optionValues: p.opts }),
              ...(p.weight !== undefined && { weightGrams: p.weight }),
            }, actorId);
            if (p.stock !== undefined) {
              const inv = await this.prisma.inventory.findUniqueOrThrow({ where: { variantId: id } });
              if (p.stock !== inv.onHand) {
                await this.products.adjustStock(house, id, { delta: p.stock - inv.onHand, reason: 'ADJUSTMENT', note: 'CSV import', lowStockThreshold: p.threshold }, actorId);
                report.stockChanges++;
              } else if (p.threshold !== undefined) {
                await this.prisma.inventory.update({ where: { variantId: id }, data: { lowStockThreshold: p.threshold } });
              }
            }
          } catch (e) {
            issue(p.r, (e as Error).message);
          }
        }
        if (status === 'active' && existing._count.images) await this.admin.setStatus(existing.id, 'ACTIVE', actorId).catch((e: Error) => issue(first, e.message));
        if (status === 'draft' || status === 'archived') await this.admin.setStatus(existing.id, status === 'draft' ? 'DRAFT' : 'ARCHIVED', actorId);
      } catch (e) {
        issue(first, (e as Error).message);
      }
    }
    if (!dryRun) {
      await this.audit.log({ actorId, action: 'product.csv_import', entityType: 'Catalog', entityId: house.storeId, after: { rows: report.rows, products: report.products, variants: report.variants, errors: report.errors.length } as unknown as Prisma.InputJsonValue });
    }
    return report;
  }

  private async brandId(name: string, cache: Map<string, string>): Promise<string> {
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;
    const slug = slugify(name) || `brand-${Date.now()}`;
    const b = await this.prisma.brand.upsert({ where: { slug }, update: {}, create: { name, slug } });
    cache.set(key, b.id);
    return b.id;
  }
}
