'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Market } from '../api/types';
import { useLocale } from '../i18n/client';
import { formatMoney, type MoneyOptions } from '../money';

interface ShopValue {
  market: Market;
  siteUrl: string;
}

const ShopContext = createContext<ShopValue | null>(null);

export function ShopProvider({ market, siteUrl, children }: ShopValue & { children: ReactNode }) {
  const value = useMemo(() => ({ market, siteUrl }), [market, siteUrl]);
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopValue {
  const v = useContext(ShopContext);
  if (!v) throw new Error('useShop must be used inside <ShopProvider>');
  return v;
}

/** Formats minor units in the market currency and the page language. */
export function useMoney() {
  const { market } = useShop();
  const locale = useLocale();
  return useMemo(
    () => (minor: string | bigint | null | undefined, opts?: MoneyOptions & { currency?: string }) =>
      formatMoney(minor, opts?.currency ?? market.currency.code, locale, { minorUnits: market.currency.minorUnits, ...opts }),
    [market, locale],
  );
}
