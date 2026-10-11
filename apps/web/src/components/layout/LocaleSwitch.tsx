'use client';

import { Globe } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { switchLocalePath } from '@/lib/urls';

/** Full navigation (not client-side) so <html lang/dir>, fonts and server-rendered text all switch together. */
export function LocaleSwitch({ className = '' }: { className?: string }) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const to = t.locale === 'ar' ? 'en' : 'ar';
  const qs = params.toString();
  const href = switchLocalePath(pathname, qs ? `?${qs}` : '', to);
  return (
    <a
      href={href}
      hrefLang={to}
      lang={to}
      onClick={() => { document.cookie = `${LOCALE_COOKIE}=${to}; path=/; max-age=31536000; samesite=lax`; }}
      aria-label={t('nav.switchLanguageLabel')}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium hover:bg-white/10 ${className}`}
      data-testid="locale-switch"
    >
      <Globe className="size-4" aria-hidden />
      {t('nav.switchLanguage')}
    </a>
  );
}
