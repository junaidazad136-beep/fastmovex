'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Locale } from './config';
import type { Messages, T } from './index';
import { createTranslator } from './translate';

const I18nContext = createContext<T | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const t = useMemo(() => createTranslator(locale, messages), [locale, messages]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): T {
  const t = useContext(I18nContext);
  if (!t) throw new Error('useT must be used inside <I18nProvider>');
  return t;
}

export function useLocale(): Locale {
  return useT().locale;
}
