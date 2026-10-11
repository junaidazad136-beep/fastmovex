import type { SearchSort } from './api/types';
import { decimalToMinor } from './money';

export const SORTS: SearchSort[] = ['relevance', 'popular', 'newest', 'price_asc', 'price_desc', 'rating'];
export const PAGE_SIZE = 24;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Everything a product listing URL can say. Prices are in currency units (e.g. "150") because shoppers read the URL. */
export interface ListingQuery {
  q?: string;
  category?: string;
  brands: string[];
  store?: string;
  min?: string;
  max?: string;
  rating?: number;
  inStock: boolean;
  sort: SearchSort;
  page: number;
  /** search exactly what was typed (no spelling correction) */
  exact?: boolean;
}

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Parses untrusted query parameters into a valid listing query. Anything invalid is dropped, never forwarded. */
export function parseListing(sp: Raw): ListingQuery {
  const q = one(sp.q)?.slice(0, 100);
  const category = one(sp.category);
  const store = one(sp.store);
  const brands = (one(sp.brands) ?? '').split(',').map((b) => b.trim()).filter((b) => SLUG.test(b)).slice(0, 20);
  const min = one(sp.min);
  const max = one(sp.max);
  const rating = Number(one(sp.rating));
  const sort = one(sp.sort) as SearchSort | undefined;
  const page = Number(one(sp.page));
  return {
    q,
    exact: one(sp.exact) === '1' || undefined,
    category: category && SLUG.test(category) ? category : undefined,
    store: store && SLUG.test(store) ? store : undefined,
    brands,
    min: min && decimalToMinor(min) !== null ? min : undefined,
    max: max && decimalToMinor(max) !== null ? max : undefined,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 4 ? rating : undefined,
    inStock: one(sp.inStock) === '1' || one(sp.inStock) === 'true',
    sort: sort && SORTS.includes(sort) ? sort : q ? 'relevance' : 'popular',
    page: Number.isInteger(page) && page >= 1 && page <= 100 ? page : 1,
  };
}

/** Parameters for GET /search. */
export function toApiParams(l: ListingQuery, minorUnits: number): Record<string, string | number | boolean | undefined> {
  const minPrice = l.min ? decimalToMinor(l.min, minorUnits) ?? undefined : undefined;
  let maxPrice = l.max ? decimalToMinor(l.max, minorUnits) ?? undefined : undefined;
  if (minPrice && maxPrice && BigInt(minPrice) > BigInt(maxPrice)) maxPrice = undefined; // never send an impossible range
  return {
    q: l.q, category: l.category, store: l.store, brands: l.brands.length ? l.brands.join(',') : undefined,
    minPrice, maxPrice, minRating: l.rating, inStock: l.inStock || undefined,
    sort: l.sort, page: l.page, limit: PAGE_SIZE, spell: l.q && l.exact ? false : undefined,
  };
}

/** Back to URL form. Defaults are omitted to keep URLs short and canonical. */
export function toUrlParams(l: Partial<ListingQuery>, omit: (keyof ListingQuery)[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: keyof ListingQuery, v: string | undefined) => { if (v && !omit.includes(k)) out[k] = v; };
  set('q', l.q);
  set('exact', l.q && l.exact ? '1' : undefined);
  set('category', l.category);
  set('store', l.store);
  set('brands', l.brands?.length ? l.brands.join(',') : undefined);
  set('min', l.min);
  set('max', l.max);
  set('rating', l.rating ? String(l.rating) : undefined);
  set('inStock', l.inStock ? '1' : undefined);
  const defaultSort = l.q ? 'relevance' : 'popular';
  set('sort', l.sort && l.sort !== defaultSort ? l.sort : undefined);
  set('page', l.page && l.page > 1 ? String(l.page) : undefined);
  return out;
}

export function hasFilters(l: ListingQuery): boolean {
  return !!(l.brands.length || l.min || l.max || l.rating || l.inStock);
}
