import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { env } from '@/lib/env';

/**
 * The API calls this right after staff change something the shop caches (settings, pages, home page, a product),
 * so the change shows on the next visit instead of after the cache time. Only our API knows the key.
 */
const ALLOWED = /^(markets|home|categories|pages|offers|faq|sitemap|search|(product|store|brand):[a-z0-9-]{1,120})$/;

function sameKey(given: string | null): boolean {
  const key = env.internalApiKey;
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!sameKey(req.headers.get('x-internal-key'))) return Response.json({ message: 'Forbidden' }, { status: 403 });
  let tags: unknown;
  try {
    tags = ((await req.json()) as { tags?: unknown }).tags;
  } catch {
    return Response.json({ message: 'Invalid body' }, { status: 400 });
  }
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > 20 || !tags.every((t) => typeof t === 'string' && ALLOWED.test(t))) {
    return Response.json({ message: 'Unknown tags' }, { status: 400 });
  }
  // expire: 0 → the next visitor gets fresh data (staff expect to see their change right away)
  for (const t of new Set(tags as string[])) revalidateTag(t, { expire: 0 });
  return Response.json({ revalidated: tags });
}
