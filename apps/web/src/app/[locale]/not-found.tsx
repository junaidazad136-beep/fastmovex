import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { EmptyState } from '@/components/ui/EmptyState';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export default async function NotFound() {
  // not-found has no params; the language comes from the URL the proxy saw.
  const seg = (await headers()).get('x-fmx-locale');
  const locale = isLocale(seg) ? seg : 'en';
  const t = getT(locale);
  return (
    <div className="container-page py-16">
      <EmptyState
        icon={<SearchX className="size-7" aria-hidden />}
        title={t('errors.notFoundTitle')}
        text={t('errors.notFoundText')}
        action={<Link href={`/${locale}`} className="btn-primary">{t('errors.goHome')}</Link>}
      />
    </div>
  );
}
