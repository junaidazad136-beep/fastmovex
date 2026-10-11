export const SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'newest', 'popular'] as const;
export type SearchSort = (typeof SORTS)[number];

/** Normalized, already-validated search request. Engines never see raw user input. */
export interface SearchParams {
  countryCode: string;
  q?: string;
  categoryPath?: string; // resolved from slug; includes the whole subtree
  brandSlugs?: string[];
  storeSlug?: string;
  minPrice?: bigint;
  maxPrice?: bigint;
  minRating?: number;
  inStock?: boolean;
  sort: SearchSort;
  limit: number;
  offset: number;
  /** "all": every word must match (precise, fast). "any": at least one word (fallback when "all" finds too little). */
  matchMode?: MatchMode;
  /** synonyms of words in q (from the market's search settings) */
  expand?: Record<string, string[]>;
}

export type MatchMode = 'all' | 'any';

export interface SearchHits {
  ids: string[];
  total: number;
  matchMode?: MatchMode;
}

export interface Facets {
  categories: { slug: string; name: string; nameAr: string; count: number }[];
  brands: { slug: string; name: string; count: number }[];
  price: { minMinor: string | null; maxMinor: string | null };
}

export interface Suggestions {
  /** with the first photo, the lowest price (minor units) and whether any variant is in stock */
  products: { slug: string; title: string; titleAr: string | null; priceMinor?: string; imageUrl?: string | null; inStock?: boolean; category?: string; categoryAr?: string }[];
  categories: { slug: string; name: string; nameAr: string }[];
  brands: { slug: string; name: string; nameAr?: string | null }[];
  /** popular searches starting like the text typed */
  queries: string[];
}

/**
 * Swap point for Typesense / Meilisearch / Elasticsearch.
 * Implement this interface, register it as the SearchEngine provider, and nothing else changes.
 */
export abstract class SearchEngine {
  abstract search(p: SearchParams): Promise<SearchHits>;
  abstract facets(p: SearchParams): Promise<Facets>;
  abstract suggest(q: string, countryCode: string): Promise<Suggestions>;
  /** Words the catalogue uses, for spelling suggestions (an engine with its own typo handling may return []). */
  abstract vocabulary(): Promise<{ word: string; ndoc: number }[]>;
}
