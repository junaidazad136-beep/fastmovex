import { NextResponse, type NextRequest } from 'next/server';
import { env, tileOrigin } from './lib/env';

function origin(url: string | undefined): string {
  if (!url) return '';
  try { return new URL(url).origin; } catch { return ''; }
}

/** Strict, per-request CSP: scripts only with this response's nonce; network calls only to our API. */
export function buildCsp(nonce: string, opts: { dev: boolean; apiOrigin: string; mediaOrigin: string; tileOrigin?: string }): string {
  const { dev, apiOrigin, mediaOrigin } = opts;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${mediaOrigin} ${opts.tileOrigin ?? ''}`.replace(/\s+/g, ' ').trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}${dev ? ' ws: wss:' : ''}`.trim(),
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== 'production',
    apiOrigin: origin(process.env.PUBLIC_API_URL || 'http://localhost:4000'),
    mediaOrigin: origin(process.env.MEDIA_URL),
    tileOrigin: tileOrigin(env.mapTileUrl), // map tiles for the drivers' live map
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
