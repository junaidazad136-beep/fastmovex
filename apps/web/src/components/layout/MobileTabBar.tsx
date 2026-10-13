'use client';

import { Heart, Home, LayoutGrid, ShoppingCart, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useSession } from '@/lib/state/session';
import { paths } from '@/lib/urls';

/** App-style bottom navigation on phones: Home, Categories, Cart, Wishlist, Account. */
export function MobileTabBar() {
  const t = useT();
  const l = t.locale;
  const pathname = usePathname();
  const { count } = useCart();
  const { status } = useSession();
  const tabs = [
    { href: paths.home(l), label: t('common.home'), Icon: Home, active: pathname === `/${l}` },
    { href: `/${l}/categories`, label: t('nav.categories'), Icon: LayoutGrid, active: pathname.startsWith(`/${l}/categories`) || pathname.startsWith(`/${l}/c/`) },
    { href: paths.cart(l), label: t('nav.cart'), Icon: ShoppingCart, active: pathname.startsWith(`/${l}/cart`), badge: count },
    { href: paths.wishlist(l), label: t('nav.wishlist'), Icon: Heart, active: pathname.startsWith(paths.wishlist(l)) },
    { href: status === 'user' ? paths.account(l) : paths.login(l), label: t('nav.account'), Icon: User, active: (pathname.startsWith(`/${l}/account`) && !pathname.startsWith(paths.wishlist(l))) || pathname.startsWith(`/${l}/login`) },
  ];
  // Checkout has its own pay button; product pages show a price + "Add to cart" bar in this place.
  if (pathname.startsWith(`/${l}/checkout`) || pathname.startsWith(`/${l}/p/`)) return null;
  return (
    <nav aria-label={t('nav.menu')} className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {tabs.map(({ href, label, Icon, active, badge }) => (
          <li key={label}>
            <Link href={href} aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${active ? 'text-brand-600' : 'text-ink-600'}`}>
              <span className="relative">
                <Icon className={`size-[23px] ${active ? 'fill-brand-600 text-brand-600' : ''}`} strokeWidth={active ? 2 : 1.8} aria-hidden />
                {!!badge && badge > 0 && (
                  <span className="tabular absolute -end-2.5 -top-1.5 min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[10.5px] font-bold leading-[18px] text-white ring-2 ring-white">{badge > 99 ? '99+' : badge}</span>
                )}
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
