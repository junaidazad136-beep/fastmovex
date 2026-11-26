import { Compass, Headset, Heart, LayoutGrid, PackageSearch, Receipt, Store, Tag } from 'lucide-react';
import Link from 'next/link';
import type { T } from '@/lib/i18n';
import { paths } from '@/lib/urls';

/** Round shortcut buttons under the banner, like a super-app home: two rows of four. Phones only. */
export function QuickLinks({ t }: { t: T }) {
  const l = t.locale;
  const items = [
    { href: paths.offers(l), label: t('nav.offers'), Icon: Tag },
    { href: `/${l}/categories`, label: t('nav.categories'), Icon: LayoutGrid },
    { href: paths.track(l), label: t('nav.track'), Icon: PackageSearch },
    { href: paths.orders(l), label: t('nav.orders'), Icon: Receipt },
    { href: paths.wishlist(l), label: t('nav.wishlist'), Icon: Heart },
    { href: paths.seller(l), label: t('home.sell'), Icon: Store },
    { href: paths.help(l), label: t('nav.help'), Icon: Compass },
    { href: paths.contact(l), label: t('nav.contact'), Icon: Headset },
  ];
  return (
    <nav aria-label={t('home.quick')} className="container-page mt-4 md:hidden">
      <ul className="grid grid-cols-4 gap-y-3">
        {items.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className="flex flex-col items-center gap-1.5 text-center">
              <span className="grid size-[48px] place-items-center rounded-2xl bg-brand-50 text-brand-700"><Icon className="size-[21px]" strokeWidth={1.8} aria-hidden /></span>
              <span className="line-clamp-2 min-h-[28px] w-full px-0.5 text-[11.5px] font-medium leading-[14px] text-ink-800">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
