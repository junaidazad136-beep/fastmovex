import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Free test hosting puts the admin panel (vercel.app) and the API (onrender.com) on different sites, where browsers never
 * send the SameSite=Strict sign-in cookie. API_PROXY_TARGET (e.g. https://fastmovex-api.onrender.com) serves the API under
 * this site's own /api/v1 instead — then set PUBLIC_API_URL to https://<this site>/api/v1. Not needed when the API has
 * its own subdomain of the same domain (api.fastmovex.qa).
 */
const apiProxy = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');

/**
 * The admin panel is a client-rendered app behind a staff login. Product photos are shown with plain <img>
 * (thumbnails from our own media storage), so there is no image optimizer to lock down.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  async rewrites() {
    return apiProxy ? [{ source: '/api/v1/:path*', destination: `${apiProxy}/api/v1/:path*` }] : [];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
          ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
        ],
      },
      // geolocation for our own origin only: the driver page shares the driver's position, and drivers reach it by an
      // in-app navigation from /login (the policy of the first page loaded applies to the whole visit)
      { source: '/:path*', headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' }] },
    ];
  },
};

export default nextConfig;
