import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { urlset, XML_HEADERS, type UrlEntry } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

type Rows = { items: { slug: string; updatedAt: string | null; title?: string; titleAr?: string | null; images?: string[] }[] };

export async function GET(_req: Request, ctx: RouteContext<'/sitemaps/[file]'>) {
  const { file } = await ctx.params;
  let entries: UrlEntry[];
  if (file === 'pages.xml') {
    const [cats, stores, pages, brands] = await Promise.all([
      serverApi.sitemap<Rows>({ kind: 'categories' }),
      serverApi.sitemap<Rows>({ kind: 'stores' }),
      serverApi.pages().catch(() => []),
      serverApi.sitemapBrands().catch(() => ({ items: [] })),
    ]);
    entries = [
      { path: '', changefreq: 'daily', priority: 1 },
      { path: '/categories', changefreq: 'weekly', priority: 0.6 },
      { path: '/help', changefreq: 'monthly', priority: 0.3 },
      { path: '/help/returns', changefreq: 'monthly', priority: 0.3 },
      { path: '/help/delivery', changefreq: 'monthly', priority: 0.3 },
      ...['/policies', '/terms', '/privacy', '/seller-policy'].map((path) => ({ path, changefreq: 'monthly' as const, priority: 0.3 })),
      { path: '/offers', changefreq: 'daily', priority: 0.8 },
      { path: '/contact', changefreq: 'monthly', priority: 0.3 },
      ...pages.filter((pg) => !['privacy', 'terms'].includes(pg.slug)).map((pg) => ({ path: `/${pg.slug}`, lastmod: pg.updatedAt, changefreq: 'monthly' as const, priority: 0.3 })),
      ...cats.items.map((c) => ({ path: `/c/${c.slug}`, lastmod: c.updatedAt, changefreq: 'daily' as const, priority: 0.8 })),
      ...stores.items.map((s) => ({ path: `/store/${s.slug}`, lastmod: s.updatedAt, changefreq: 'weekly' as const, priority: 0.5 })),
      ...brands.items.map((b) => ({ path: `/brand/${b.slug}`, changefreq: 'weekly' as const, priority: 0.6 })),
    ];
  } else {
    const m = /^products-(\d{1,4})\.xml$/.exec(file);
    if (!m) return new Response('Not found', { status: 404 });
    const rows = await serverApi.sitemap<Rows>({ kind: 'products', page: Number(m[1]) });
    if (!rows.items.length) return new Response('Not found', { status: 404 });
    entries = rows.items.map((p) => ({ path: `/p/${p.slug}`, lastmod: p.updatedAt, changefreq: 'weekly', priority: 0.7, images: (p.images ?? []).map((url) => ({ url, title: p.title })) }));
  }
  return new Response(urlset(env.siteUrl, entries), { headers: XML_HEADERS });
}
