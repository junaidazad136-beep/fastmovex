import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { StorefrontService } from '../common/storefront.service';
import { cleanFaq } from '../seo/seo-rules';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../common/utils/slug';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { validateUpload } from '../storage/file-validation';
import { tilePicture } from '../storage/photo';
import { StorageService } from '../storage/storage.service';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/category.dto';

export const MAX_CATEGORY_DEPTH = 3; // Electronics > Phones > Cases

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  nameAr: string;
  iconUrl: string | null;
  /** the tile picture on the categories page and home row (admin upload; drawn defaults until then) */
  imageUrl: string | null;
  sortOrder: number;
  children: CategoryNode[];
}

type Row = { id: string; parentId: string | null; slug: string; name: string; nameAr: string; iconKey: string | null; imageKey?: string | null; sortOrder: number };

/** Pure: flat rows -> nested tree, sorted by sortOrder. Exported for tests. */
export function buildTree(rows: Row[], toUrl: (k: string | null) => string | null): CategoryNode[] {
  const nodes = new Map<string, CategoryNode & { parentId: string | null }>();
  for (const r of rows) {
    nodes.set(r.id, { id: r.id, slug: r.slug, name: r.name, nameAr: r.nameAr, iconUrl: toUrl(r.iconKey), imageUrl: toUrl(r.imageKey ?? null), sortOrder: r.sortOrder, parentId: r.parentId, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else if (!n.parentId) roots.push(n);
    // child of an inactive parent is dropped: hidden parent hides its subtree
  }
  const sort = (list: CategoryNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    list.forEach((c) => sort(c.children));
    return list;
  };
  const strip = (n: CategoryNode & { parentId?: string | null }): CategoryNode => {
    const { parentId: _p, ...rest } = n;
    return { ...rest, children: n.children.map(strip) };
  };
  return sort(roots).map(strip);
}

const SEO_KEYS = ['description', 'descriptionAr', 'seoTitle', 'seoTitleAr', 'seoDescription', 'seoDescriptionAr', 'faq'] as const;
/** Only the SEO fields that were sent (null clears one); the FAQ is cleaned to complete questions. */
function seoData(dto: CreateCategoryDto | UpdateCategoryDto) {
  const out: { description?: string | null; descriptionAr?: string | null; seoTitle?: string | null; seoTitleAr?: string | null; seoDescription?: string | null; seoDescriptionAr?: string | null; faq?: Prisma.InputJsonValue } = {};
  for (const k of SEO_KEYS) {
    if (dto[k] === undefined) continue;
    if (k === 'faq') out.faq = cleanFaq(dto.faq) as unknown as Prisma.InputJsonValue;
    else out[k] = dto[k] ?? null;
  }
  return out;
}

@Injectable()
export class CategoriesService {
  private cache?: { at: number; tree: CategoryNode[] };
  private static readonly TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Optional() private readonly storefront?: StorefrontService,
  ) {}

  async publicTree(): Promise<CategoryNode[]> {
    if (this.cache && Date.now() - this.cache.at < CategoriesService.TTL_MS) return this.cache.tree;
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, parentId: true, slug: true, name: true, nameAr: true, iconKey: true, imageKey: true, sortOrder: true },
    });
    const tree = buildTree(rows, (k) => this.storage.publicUrl(k));
    this.cache = { at: Date.now(), tree };
    return tree;
  }

  async bySlug(slug: string) {
    const cat = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true, slug: true, name: true, nameAr: true, path: true, imageKey: true,
        description: true, descriptionAr: true, seoTitle: true, seoTitleAr: true, seoDescription: true, seoDescriptionAr: true, faq: true,
      },
    });
    if (!cat) throw new NotFoundException('Category not found');
    const slugs = cat.path.split('/');
    const crumbs = await this.prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, name: true, nameAr: true },
    });
    const breadcrumbs = slugs.map((s) => crumbs.find((c) => c.slug === s)).filter(Boolean);
    const tree = await this.publicTree();
    const findNode = (list: CategoryNode[]): CategoryNode | undefined => {
      for (const n of list) { if (n.id === cat.id) return n; const f = findNode(n.children); if (f) return f; }
      return undefined;
    };
    const { path: _path, imageKey, faq, ...rest } = cat;
    return { ...rest, faq: cleanFaq(faq), imageUrl: this.storage.publicUrl(imageKey), breadcrumbs, children: findNode(tree)?.children ?? [] };
  }

  async adminList() {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
      include: { _count: { select: { products: true, children: true } } },
    });
    return rows.map((r) => ({ ...r, imageUrl: this.storage.publicUrl(r.imageKey) }));
  }

  async create(dto: CreateCategoryDto, actorId: string) {
    const slug = dto.slug ?? slugify(dto.name);
    const parent = dto.parentId ? await this.mustGet(dto.parentId) : null;
    const depth = parent ? parent.depth + 1 : 0;
    if (depth >= MAX_CATEGORY_DEPTH) throw new BadRequestException(`Categories can be at most ${MAX_CATEGORY_DEPTH} levels deep`);

    const created = await this.uniqueGuard(() =>
      this.prisma.category.create({
        data: {
          name: dto.name, nameAr: dto.nameAr, slug, parentId: parent?.id ?? null,
          path: parent ? `${parent.path}/${slug}` : slug, depth,
          sortOrder: dto.sortOrder ?? 0, isActive: dto.isActive ?? true,
          ...seoData(dto),
        },
      }),
    );
    await this.audit.log({ actorId, action: 'category.create', entityType: 'Category', entityId: created.id, after: { slug, parentId: created.parentId } });
    this.cache = undefined;
    return created;
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string) {
    const current = await this.mustGet(id);
    const slug = dto.slug ?? current.slug;
    const movingParent = dto.parentId !== undefined && dto.parentId !== current.parentId;
    let parent: { id: string; path: string; depth: number } | null = null;

    if (movingParent && dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
      parent = await this.mustGet(dto.parentId);
      if (parent.path.startsWith(`${current.path}/`)) {
        throw new BadRequestException('Cannot move a category inside its own subcategory');
      }
    } else if (!movingParent && current.parentId) {
      parent = await this.mustGet(current.parentId);
    }

    const newPath = parent ? `${parent.path}/${slug}` : slug;
    const newDepth = parent ? parent.depth + 1 : 0;
    const depthDelta = newDepth - current.depth;
    const deepest = await this.prisma.category.aggregate({ where: { path: { startsWith: `${current.path}/` } }, _max: { depth: true } });
    if ((deepest._max.depth ?? current.depth) + depthDelta >= MAX_CATEGORY_DEPTH) {
      throw new BadRequestException(`Categories can be at most ${MAX_CATEGORY_DEPTH} levels deep`);
    }

    const updated = await this.uniqueGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.category.update({
          where: { id },
          data: {
            name: dto.name, nameAr: dto.nameAr, slug, sortOrder: dto.sortOrder, isActive: dto.isActive,
            parentId: movingParent ? dto.parentId ?? null : undefined,
            ...seoData(dto),
            path: newPath, depth: newDepth,
          },
        });
        if (newPath !== current.path) {
          // Re-root every descendant's materialized path in one statement
          await tx.$executeRaw`
            UPDATE "Category"
            SET "path" = ${newPath}::text || substring("path" from ${current.path.length + 1}::int),
                "depth" = "depth" + ${depthDelta}::int
            WHERE "path" LIKE ${current.path + '/%'}`;
        }
        return row;
      }),
    );
    await this.audit.log({ actorId, action: 'category.update', entityType: 'Category', entityId: id, before: { path: current.path, isActive: current.isActive }, after: { path: newPath, isActive: updated.isActive, seo: SEO_KEYS.filter((k) => dto[k] !== undefined) } });
    this.storefront?.refresh('categories');
    this.cache = undefined;
    return updated;
  }

  async remove(id: string, actorId: string) {
    const cat = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
    if (!cat) throw new NotFoundException('Category not found');
    if (cat._count.children || cat._count.products) {
      throw new ConflictException('Category has subcategories or products. Move them or deactivate the category instead.');
    }
    try {
      await this.prisma.category.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Category is used by commission rules or coupons. Deactivate it instead.');
      }
      throw err;
    }
    await this.audit.log({ actorId, action: 'category.delete', entityType: 'Category', entityId: id, before: { slug: cat.slug } });
    this.cache = undefined;
  }

  /**
   * The category's tile picture (categories page, home row). Any photo works; a product cut-out on a transparent
   * background looks best. Kept as WebP (transparency kept), at most 800 px. The old file is left in storage: pages
   * the website cached for a few minutes still point at it, and a deleted file would show as a broken picture.
   */
  async setImage(id: string, file: Express.Multer.File | undefined, actorId: string) {
    const cat = await this.mustGet(id);
    const f = validateUpload(file, 'image');
    const pic = await tilePicture(f.buffer);
    const key = `categories/${cat.slug}-${randomUUID().slice(0, 8)}.webp`;
    await this.storage.put('public', key, pic.buffer, pic.mime);
    await this.prisma.category.update({ where: { id }, data: { imageKey: key } });
    await this.audit.log({ actorId, action: 'category.image', entityType: 'Category', entityId: id, after: { imageKey: key } });
    this.changed();
    return { imageUrl: this.storage.publicUrl(key) };
  }

  async removeImage(id: string, actorId: string) {
    const cat = await this.mustGet(id);
    if (!cat.imageKey) return;
    await this.prisma.category.update({ where: { id }, data: { imageKey: null } });
    await this.audit.log({ actorId, action: 'category.image_remove', entityType: 'Category', entityId: id });
    this.changed();
  }

  /** Category tiles changed: drop the cached tree and tell the website. */
  private changed() {
    this.cache = undefined;
    this.storefront?.refresh('categories', 'home');
  }

  async reorder(dto: ReorderCategoriesDto, actorId: string) {
    await this.prisma.$transaction(dto.items.map((i) => this.prisma.category.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })));
    await this.audit.log({ actorId, action: 'category.reorder', entityType: 'Category', after: { count: dto.items.length } });
    this.cache = undefined;
  }

  private async mustGet(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  private async uniqueGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A category with this slug already exists');
      }
      throw err;
    }
  }
}
