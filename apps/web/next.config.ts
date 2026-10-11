import type { NextConfig } from 'next';

/**
 * Product images come from the media CDN (S3 / R2 / MinIO). Its origin is needed at build time so the
 * image optimizer only ever fetches from our own storage (no open proxy / SSRF).
 */
const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL;
const media = mediaUrl ? new URL(mediaUrl) : null;
const isProd = process.env.NODE_ENV === 'production';

/**
 * Free test hosting puts the website (vercel.app) and the API (onrender.com) on different sites, where browsers never
 * send the SameSite=Strict sign-in cookie. API_PROXY_TARGET (e.g. https://fastmovex-api.onrender.com) serves the API under
 * this site's own /api/v1 instead — then set PUBLIC_API_URL to https://<this site>/api/v1. Not needed when the API has
 * its own subdomain of the same domain (api.fastmovex.qa).
 */
const apiProxy = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    // Without a media origin there is nothing safe to optimize: serve images as they are.
    unoptimized: !media || process.env.IMAGE_OPTIMIZATION === 'false',
    remotePatterns: media
      ? [{ protocol: media.protocol.replace(':', '') as 'http' | 'https', hostname: media.hostname, port: media.port, pathname: `${media.pathname.replace(/\/$/, '')}/**` }]
      : [],
    // Only for a local S3 emulator on 127.0.0.1 (read at build time). Never set it for a real deployment: SSRF risk.
    dangerouslyAllowLocalIP: process.env.IMAGE_ALLOW_LOCAL_IP === 'true',
    formats: ['image/avif', 'image/webp'],
    // Few, well-spaced widths: every width is listed in each image's srcset (HTML size) and is one more cached variant.
    deviceSizes: [480, 640, 828, 1080, 1536],
    imageSizes: [64, 128, 256, 384],
    qualities: [70, 80],
  },
  async rewrites() {
    return apiProxy ? [{ source: '/api/v1/:path*', destination: `${apiProxy}/api/v1/:path*` }] : [];
  },
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(self)' }, // camera: barcode search; microphone: voice search,
      ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
    ];
    return [
      { source: '/:path*', headers: security },
      // The service worker must never be cached by the browser, or updates would be stuck for a day.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default nextConfig;
