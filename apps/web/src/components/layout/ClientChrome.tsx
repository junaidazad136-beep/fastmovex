'use client';

import { WhatsAppChat } from '../ui/WhatsApp';
import { WifiOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { useCart } from '@/lib/state/cart';

/** Offline banner + service worker registration + one-off notices that belong to the whole app. */
export function ClientChrome() {
  const t = useT();
  const toast = useToast();
  const { merged } = useCart();
  const [offline, setOffline] = useState(false);
  const pathname = usePathname();

  // anonymous visit analytics (see lib/analytics.ts): one page view per route
  useEffect(() => { track('page_view', pathname); }, [pathname]);

  useEffect(() => {
    const on = () => { setOffline(false); };
    const off = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* the site works without it */ });
  }, []);

  useEffect(() => {
    if (merged) toast({ tone: 'info', message: t('cart.mergedNotice') });
  }, [merged, toast, t]);

  return (
    <>
      {offline && (
        <div role="status" className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-ink-900 px-4 py-2 text-sm text-white">
          <WifiOff className="size-4" aria-hidden />
          {t('errors.offline')}
        </div>
      )}
      <WhatsAppChat />
    </>
  );
}
