'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { paths } from '@/lib/urls';

/** "Terms of use · Returns & warranty · Privacy policy" under a form the customer agrees to by submitting. */
export function PolicyLinks({ returns = false }: { returns?: boolean }) {
  const t = useT();
  const l = t.locale;
  const links = [
    { href: paths.terms(l), label: t('footer.terms') },
    ...(returns ? [{ href: paths.returnsPolicy(l), label: t('help.returnsPolicy') }] : []),
    { href: paths.privacy(l), label: t('footer.privacy') },
  ];
  return (
    <span className="inline-flex flex-wrap gap-x-1.5" data-testid="policy-links">
      {links.map((x, i) => (
        <span key={x.href}>{i > 0 && <span aria-hidden className="me-1.5">·</span>}<Link href={x.href} target="_blank" className="link">{x.label}</Link></span>
      ))}
    </span>
  );
}
