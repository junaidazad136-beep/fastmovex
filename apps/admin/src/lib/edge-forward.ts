import { NextResponse, type NextRequest } from 'next/server';

/**
 * This site serves the API under its own /api/v1 (API_PROXY_TARGET). Seen from the API, every shopper would then come
 * from this site's servers — one IP for everybody, so the API's per-IP rate limits would treat all shoppers as one.
 * Here each API request is passed on with the shopper's own IP (x-fmx-client-ip) and the shared INTERNAL_API_KEY
 * (x-fmx-edge-key), which the API checks before it believes the IP. Nothing is added for the browser to see.
 *
 * The IP is read from x-forwarded-for, which Vercel sets itself (a visitor cannot fake it there). Elsewhere the header
 * is only trusted with TRUST_PROXY_IP=true (when this site runs behind a proxy that sets it).
 */
export const EDGE_IP_HEADER = 'x-fmx-client-ip';
export const EDGE_KEY_HEADER = 'x-fmx-edge-key';

/** The visitor's IP as the hosting platform reports it, or null where that header cannot be trusted. Exported for tests. */
export function visitorIp(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  if (!env.VERCEL && env.TRUST_PROXY_IP !== 'true') return null;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim();
  return first && /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : null;
}

/** The API request passed on to the API with the shopper's IP, or null to leave it to the next.config rewrite. */
export function forwardApi(request: NextRequest, env: Record<string, string | undefined> = process.env): NextResponse | null {
  const target = env.API_PROXY_TARGET?.replace(/\/+$/, '');
  const key = env.INTERNAL_API_KEY;
  if (!target || !key || key.length < 32) return null;
  const headers = new Headers(request.headers);
  // whatever a visitor sent in these headers never reaches the API
  headers.delete(EDGE_IP_HEADER);
  headers.delete(EDGE_KEY_HEADER);
  const ip = visitorIp(request.headers, env);
  if (ip) {
    headers.set(EDGE_IP_HEADER, ip);
    headers.set(EDGE_KEY_HEADER, key);
  }
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${target}${pathname}${search}`), { request: { headers } });
}
