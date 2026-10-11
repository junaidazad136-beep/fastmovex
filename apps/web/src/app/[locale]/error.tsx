'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useT } from '@/lib/i18n/client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="container-page py-16">
      <EmptyState
        icon={<AlertTriangle className="size-7" aria-hidden />}
        title={t('errors.serverTitle')}
        text={t('errors.serverText')}
        action={<button type="button" onClick={reset} className="btn-primary">{t('common.retry')}</button>}
      />
    </div>
  );
}
