import { BadRequestException } from '@nestjs/common';

/** Built-in home sections, in the default order. "personal" ones depend on the shopper and are never cached. */
export const BUILTIN_SECTIONS: { key: string; label: string; description: string; personal?: boolean }[] = [
  { key: 'hero', label: 'Main banners', description: 'The big slider (Banners › Home page — main slider)' },
  { key: 'value_props', label: 'Why shop with us', description: 'Delivery, cash on delivery, easy returns, trusted store' },
  { key: 'categories', label: 'Shop by category', description: 'Top-level categories as tiles' },
  { key: 'flash_deals', label: 'Flash deals', description: 'Products in live flash sales, with countdown' },
  { key: 'recently_viewed', label: 'Recently viewed', description: 'What this shopper looked at (signed-in shoppers)', personal: true },
  { key: 'recommended', label: 'Recommended for you', description: 'Based on what this shopper browses', personal: true },
  { key: 'sponsored', label: 'Sponsored', description: 'Products promoted with a sponsored period' },
  { key: 'trending', label: 'Trending now', description: 'Most bought and viewed in the last 60 days' },
  { key: 'fastmovex_exclusive', label: 'FastMoveX exclusives', description: 'Products in live "FastMoveX exclusive" campaigns' },
  { key: 'nearby_sellers', label: 'Stores near you', description: 'When the app shares its location', personal: true },
  { key: 'best_sellers', label: 'Best sellers', description: 'Most sold, in stock' },
  { key: 'featured', label: 'Featured', description: 'Products marked "Feature on home page"' },
  { key: 'featured_sellers', label: 'Top stores', description: 'Stores marked as featured' },
  { key: 'new_arrivals', label: 'New arrivals', description: 'Newest products, in stock' },
  { key: 'promo', label: 'Promotion banners', description: 'Banners › Home page — middle strip' },
];
export const BUILTIN_KEYS = BUILTIN_SECTIONS.map((s) => s.key);
export const COLLECTION = 'collection';

export type CollectionSource = 'category' | 'tag' | 'products' | 'sale';
export type CollectionSort = 'popular' | 'newest' | 'price_asc' | 'price_desc';
export interface CollectionConfig {
  source: CollectionSource;
  categoryId?: string;
  tag?: string;
  productIds?: string[];
  sort?: CollectionSort;
  limit?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks a custom collection's settings; returns a clean copy (unknown keys dropped). */
export function parseCollectionConfig(raw: unknown): CollectionConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const source = c.source as CollectionSource;
  if (!['category', 'tag', 'products', 'sale'].includes(source)) throw new BadRequestException('Collection: choose what it shows (category, tag, chosen products or products on sale)');
  const sort = (c.sort ?? 'popular') as CollectionSort;
  if (!['popular', 'newest', 'price_asc', 'price_desc'].includes(sort)) throw new BadRequestException('Collection: unknown sort');
  const limit = c.limit === undefined ? 12 : Number(c.limit);
  if (!Number.isInteger(limit) || limit < 4 || limit > 24) throw new BadRequestException('Collection: show between 4 and 24 products');
  const out: CollectionConfig = { source, sort, limit };
  if (source === 'category') {
    if (typeof c.categoryId !== 'string' || !UUID.test(c.categoryId)) throw new BadRequestException('Collection: choose a category');
    out.categoryId = c.categoryId;
  }
  if (source === 'tag') {
    const tag = typeof c.tag === 'string' ? c.tag.trim().toLowerCase() : '';
    if (!tag || tag.length > 40) throw new BadRequestException('Collection: enter a tag');
    out.tag = tag;
  }
  if (source === 'products') {
    const ids = Array.isArray(c.productIds) ? c.productIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [];
    if (!ids.length) throw new BadRequestException('Collection: choose at least one product');
    if (ids.length > 24) throw new BadRequestException('Collection: at most 24 products');
    out.productIds = [...new Set(ids)];
  }
  return out;
}
