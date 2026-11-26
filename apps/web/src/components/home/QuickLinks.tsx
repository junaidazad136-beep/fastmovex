import { Headset, PackageSearch, Receipt, Tag } from 'lucide-react';
import Link from 'next/link';
import type { T } from '@/lib/i18n';
import { paths } from '@/lib/urls';

/** Round shortcut buttons under the banner, like a super-app home: one row of four. Phones only. */
export function QuickLinks({ t }: { t: T }) {
  const l = t.locale;
  const items = [
    { href: paths.offers(l), label: t('nav.offers'), Icon: Tag },
    { href: paths.track(l), label: t('nav.track'), Icon: PackageSearch },
    { href: paths.orders(l), label: t('nav.orders'), Icon: Receipt },
    { href: paths.contact(l), label: t('nav.contact'), Icon: Headset },
  ];
  return (
    <nav aria-label={t('home.quick')} className="container-page mt-2 md:hidden">
      <ul className="grid grid-cols-4">
        {items.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className="flex flex-col items-center gap-0.5 text-center">
              <span className="grid size-[42px] place-items-center rounded-2xl bg-brand-50 text-brand-700"><Icon className="size-[19px]" strokeWidth={1.8} aria-hidden /></span>
              <span className="block w-full truncate px-0.5 text-[11.5px] font-medium leading-4 text-ink-800">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
