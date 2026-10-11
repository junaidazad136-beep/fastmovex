import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE, negotiateLocale } from './lib/i18n/config';

function origin(url: string | undefined): string {
  if (!url) return '';
  try { return new URL(url).origin; } catch { return ''; }
}

/** Strict, per-request CSP: scripts only with this response's nonce; network calls only to our API. */
/** Sign in with Google / Apple: their scripts, Google's button frame and stylesheet, Apple's sign-in window. */
const SOCIAL = { script: 'https://accounts.google.com/gsi/client https://appleid.cdn-apple.com', style: 'https://accounts.google.com/gsi/style', frame: 'https://accounts.google.com/gsi/ https://appleid.apple.com', connect: 'https://accounts.google.com/gsi/' };

export function buildCsp(nonce: string, opts: { dev: boolean; apiOrigin: string; mediaOrigin: string; social?: boolean }): string {
  const { dev, apiOrigin, mediaOrigin } = opts;
  const social = opts.social !== false;
  return [
    "default-src 'self'",
    // with 'strict-dynamic' modern browsers ignore host lists; they are the fallback for older ones
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${social ? ` ${SOCIAL.script}` : ''}${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'${social ? ` ${SOCIAL.style}` : ''}`,
    `img-src 'self' data: blob: ${mediaOrigin}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}${social ? ` ${SOCIAL.connect}` : ''}${dev ? ' ws: wss:' : ''}`.replace(/\s+/g, ' ').trim(),
    "manifest-src 'self'",
    "worker-src 'self'",
    social ? `frame-src ${SOCIAL.frame}` : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split('/')[1];

  // No language in the URL: send the visitor to their language (saved choice first, then the browser's).
  if (!isLocale(first)) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(saved) ? saved : negotiateLocale(request.headers.get('accept-language'));
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    url.search = search;
    return NextResponse.redirect(url, 307);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== 'production',
    apiOrigin: origin(process.env.PUBLIC_API_URL || 'http://localhost:4000'),
    mediaOrigin: origin(process.env.MEDIA_URL || process.env.NEXT_PUBLIC_MEDIA_URL),
    social: process.env.SOCIAL_SIGN_IN !== 'off',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-jovia-locale', first); // lets not-found pages (which get no params) speak the right language
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (request.cookies.get(LOCALE_COOKIE)?.value !== first) {
    response.cookies.set(LOCALE_COOKIE, first, { path: '/', maxAge: 31_536_000, sameSite: 'lax' });
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not Next internals, not files with an extension (sw.js, robots.txt, sitemap.xml, icons…)
      source: '/((?!_next/|api/|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
