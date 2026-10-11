import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Read at request time so the same build serves the right host in staging and production. */
export function GET() {
  // test copies on free hosting (*.vercel.app, *.onrender.com…) and SEARCH_ENGINES=off are never indexed
  const testHost = /localhost|127\.0\.0\.1|staging|\.vercel\.app|\.onrender\.com|\.netlify\.app|\.pages\.dev/.test(env.siteUrl);
  const production = process.env.NODE_ENV === 'production' && !testHost && process.env.SEARCH_ENGINES !== 'off';
  const body = production
    ? [
        'User-agent: *',
        'Allow: /',
        // Personal and transactional pages have nothing for search engines; internal search is not a landing page.
        ...['account', 'cart', 'checkout', 'login', 'register', 'forgot-password', 'search', 'help/tickets'].flatMap((p) => [`Disallow: /en/${p}`, `Disallow: /ar/${p}`]),
        'Disallow: /*?*sort=',
        'Disallow: /*?*page=',
        '',
        `Sitemap: ${env.siteUrl}/sitemap.xml`,
      ].join('\n')
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
