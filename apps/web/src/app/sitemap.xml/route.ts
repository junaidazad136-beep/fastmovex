import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { sitemapIndex, XML_HEADERS } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await serverApi.sitemap<{ productPages: number }>({});
  const files = ['pages.xml', ...Array.from({ length: s.productPages }, (_, i) => `products-${i + 1}.xml`)];
  return new Response(sitemapIndex(env.siteUrl, files), { headers: XML_HEADERS });
}
