'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { configureApi } from '@/lib/api/client';
import type { PublicConfig } from '@/lib/env';
import { SessionProvider } from '@/lib/state/session';
import { ToastProvider } from '@/lib/state/toast';

const ConfigContext = createContext<PublicConfig | null>(null);

export function Providers({ config, children }: { config: PublicConfig; children: ReactNode }) {
  // Configure before any child effect runs (effects fire child-first, so this cannot wait for one).
  if (typeof window !== 'undefined') configureApi({ apiUrl: config.apiUrl, country: config.country });
  return (
    <ConfigContext.Provider value={config}>
      <ToastProvider>
        <SessionProvider>{children}</SessionProvider>
      </ToastProvider>
    </ConfigContext.Provider>
  );
}

export function useConfig(): PublicConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error('useConfig outside Providers');
  return c;
}
