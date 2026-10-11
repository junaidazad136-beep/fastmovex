'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/state/session';
import { paths } from '@/lib/urls';
import { useT } from '@/lib/i18n/client';

/** Client-side gate for personal pages. The API enforces access regardless; this only avoids showing an empty page. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const t = useT();
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    if (status === 'guest') router.replace(paths.login(t.locale, `${pathname}${search ? `?${search}` : ''}`));
  }, [status, router, pathname, search, t.locale]);
  if (status !== 'user') {
    return (
      <div className="space-y-4" aria-busy="true" aria-label={t('common.loading')}>
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-32" />
        <div className="skeleton h-32" />
      </div>
    );
  }
  return <>{children}</>;
}
