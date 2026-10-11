'use client';

import { useState, type ReactNode } from 'react';
import { configureApi } from '@/lib/api/client';
import type { Market } from '@/lib/api/types';
import type { Locale } from '@/lib/i18n/config';
import type { Messages } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/client';
import { CartProvider } from '@/lib/state/cart';
import { SessionProvider } from '@/lib/state/session';
import { ShopProvider } from '@/lib/state/shop';
import { ToastProvider } from '@/lib/state/toast';
import { WishlistProvider } from '@/lib/state/wishlist';

export function Providers({
  locale, messages, market, apiUrl, siteUrl, children,
}: { locale: Locale; messages: Messages; market: Market; apiUrl: string; siteUrl: string; children: ReactNode }) {
  // Configure once, before any child effect runs.
  useState(() => { configureApi({ apiUrl, country: market.code }); return true; });
  return (
    <I18nProvider locale={locale} messages={messages}>
      <ShopProvider market={market} siteUrl={siteUrl}>
        <ToastProvider closeLabel={messages.common.close}>
          <SessionProvider>
            <CartProvider>
              <WishlistProvider>{children}</WishlistProvider>
            </CartProvider>
          </SessionProvider>
        </ToastProvider>
      </ShopProvider>
    </I18nProvider>
  );
}
