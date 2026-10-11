import 'server-only';
import { env } from '../env';
import { ApiError } from './errors';
import type {
  BrandDetail, CategoryDetail, CategoryNode, ContentPage, Faq, HomeFeed, Market, Offers, PageSummary, ProductDetail, QuestionPage, ReviewPage, SearchResult, StoreDetail,
} from './types';

/**
 * Server-side reads of PUBLIC catalogue data, shared by every visitor and cached in the Next.js data cache.
 * Nothing personal is ever fetched here: personal data is read by the browser with the user's own token.
 */
interface ReadOptions {
  revalidate?: number;
  tags?: string[];
  country?: string;
  /** big answers (the product feed) skip the data cache, which only keeps entries up to 2 MB */
  noStore?: boolean;
}

async function read<T>(path: string, opts: ReadOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-country': opts.country ?? env.defaultCountry };
  // Lets the API tell our SSR server apart from a single abusive client (per-IP rate limits).
  if (env.internalApiKey) headers['x-internal-key'] = env.internalApiKey;
  const res = await fetch(`${env.apiInternalUrl}${path}`, {
    headers,
    ...(opts.noStore ? { cache: 'no-store' as const } : { cache: 'force-cache' as const, next: { revalidate: opts.revalidate ?? 60, tags: opts.tags } }),
  });
  if (!res.ok) {
    let body: ApiError['body'] = null;
    try { body = (await res.json()) as ApiError['body']; } catch { /* not JSON */ }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const serverApi = {
  markets: () => read<Market[]>('/markets', { revalidate: 300, tags: ['markets'] }),
  async market(code = env.defaultCountry): Promise<Market> {
    const all = await serverApi.markets();
    const m = all.find((x) => x.code === code) ?? all.find((x) => x.isDefault) ?? all[0];
    if (!m) throw new ApiError(503, { message: 'No market is open' });
    return m;
  },
  home: () => read<HomeFeed>('/home', { revalidate: 60, tags: ['home'] }),
  categories: () => read<CategoryNode[]>('/categories', { revalidate: 300, tags: ['categories'] }),
  brand: (slug: string) => read<BrandDetail>(`/brands/${encodeURIComponent(slug)}`, { revalidate: 300, tags: [`brand:${slug}`] }),
  feed: <T>(page: number) => read<T>(`/feeds/products${q({ page })}`, { noStore: true }),
  sitemapBrands: () => read<{ items: { slug: string }[] }>('/sitemap/brands', { revalidate: 900, tags: ['sitemap'] }),
  category: (slug: string) => read<CategoryDetail>(`/categories/${encodeURIComponent(slug)}`, { revalidate: 300, tags: ['categories'] }),
  product: (slug: string) => read<ProductDetail>(`/products/${encodeURIComponent(slug)}`, { revalidate: 60, tags: [`product:${slug}`] }),
  productReviews: (slug: string, rating?: number) =>
    read<ReviewPage>(`/products/${encodeURIComponent(slug)}/reviews${q({ rating })}`, { revalidate: 120, tags: [`product:${slug}`] }),
  productQuestions: (slug: string) => read<QuestionPage>(`/products/${encodeURIComponent(slug)}/questions`, { revalidate: 120, tags: [`product:${slug}`] }),
  store: (slug: string) => read<StoreDetail>(`/stores/${encodeURIComponent(slug)}`, { revalidate: 120, tags: [`store:${slug}`] }),
  storeReviews: (slug: string) => read<ReviewPage>(`/stores/${encodeURIComponent(slug)}/reviews`, { revalidate: 120, tags: [`store:${slug}`] }),
  search: (params: Record<string, string | number | boolean | undefined>) => read<SearchResult>(`/search${q(params)}`, { revalidate: 30, tags: ['search'] }),
  faq: () => read<Faq[]>('/faq', { revalidate: 600, tags: ['faq'] }),
  /** What shoppers search most (home page chips) */
  popularSearches: () => read<{ queries: string[] }>('/search/popular', { revalidate: 600, tags: ['search'] }),
  pages: () => read<PageSummary[]>('/pages', { revalidate: 300, tags: ['pages'] }),
  page: (slug: string) => read<ContentPage>(`/pages/${encodeURIComponent(slug)}`, { revalidate: 300, tags: ['pages'] }),
  offers: () => read<Offers>('/offers', { revalidate: 60, tags: ['offers'] }),
  sitemap: <T>(params: Record<string, string | number | undefined>) => read<T>(`/sitemap${q(params)}`, { revalidate: 900, tags: ['sitemap'] }),
};
