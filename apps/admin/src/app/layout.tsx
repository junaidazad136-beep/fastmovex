import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { Providers } from '@/components/layout/Providers';
import { publicConfig } from '@/lib/env';

export const metadata: Metadata = {
  title: { default: 'FastMoveX Admin', template: '%s · FastMoveX Admin' },
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

export const viewport: Viewport = { themeColor: '#7422E6', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Rendered per request: runtime config (API URL) and the per-request CSP nonce.
  await connection();
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-dvh">
        <Providers config={publicConfig()}>{children}</Providers>
      </body>
    </html>
  );
}
