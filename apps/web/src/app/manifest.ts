import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'FastMoveX — Online shopping in Qatar',
    short_name: 'FastMoveX',
    description: 'Online shopping in Qatar. تسوّق أونلاين في قطر.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fcfbfa',
    theme_color: '#7422E6',
    categories: ['shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Cart · السلة', url: '/en/cart', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Orders · الطلبات', url: '/en/account/orders', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
