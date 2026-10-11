import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { buildMerchantFeed, type FeedPage } from '@/lib/merchant-feed';

export const dynamic = 'force-dynamic';

/**
 * Google Merchant Center product feeds (free listings and Shopping ads): /feeds/google-en.xml and /feeds/google-ar.xml.
 * Add them in Merchant Center → Products → Feeds → Scheduled fetch (daily). Switched off in the admin panel → no feed.
 */
export async function GET(_req: Request, ctx: RouteContext<'/feeds/[file]'>) {
  const { file } = await ctx.params;
  const m = /^google-(en|ar)\.xml$/.exec(file);
  if (!m) return new Response('Not found', { status: 404 });
  const locale = m[1] as 'en' | 'ar';
  const pages: FeedPage[] = [];
  for (let page = 1; page <= 40; page++) {
    const p = await serverApi.feed<FeedPage>(page);
    if (!p.enabled) return new Response('Not found', { status: 404 });
    pages.push(p);
    if (page * p.pageSize >= p.total) break;
  }
  return new Response(buildMerchantFeed(env.siteUrl, locale, pages), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800, s-maxage=1800' },
  });
}
