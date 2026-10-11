'use client';

import { Bell, Heart, LayoutDashboard, LifeBuoy, LogOut, MapPin, Package, RotateCcw, Star } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { paths } from '@/lib/urls';
import { RequireAuth } from '../auth/RequireAuth';
import { DeletionBanner } from './Privacy';

export function AccountShell({ children }: { children: ReactNode }) {
  const t = useT();
  const l = t.locale;
  const pathname = usePathname();
  const { user, logout } = useSession();
  const items = [
    { href: paths.account(l), label: t('account.overview'), Icon: LayoutDashboard, exact: true },
    { href: paths.orders(l), label: t('account.orders'), Icon: Package },
    { href: paths.returns(l), label: t('account.returns'), Icon: RotateCcw },
    { href: paths.wishlist(l), label: t('account.wishlist'), Icon: Heart },
    { href: paths.addresses(l), label: t('account.addresses'), Icon: MapPin },
    { href: paths.reviews(l), label: t('account.reviews'), Icon: Star },
    { href: paths.notifications(l), label: t('account.notifications'), Icon: Bell },
    { href: paths.tickets(l), label: t('account.support'), Icon: LifeBuoy },
  ];
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  async function signOut() {
    await logout();
    // A full navigation: leaves nothing of the account in memory, and wins over the "please sign in" redirect of this page.
    window.location.assign(paths.home(l));
  }

  return (
    <div className="container-page py-6">
      {/* minmax(0,1fr) on phones too: otherwise the scrolling tab strip widens the whole page sideways */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label={t('account.title')} className="min-w-0 lg:sticky lg:top-36 lg:self-start">
          {user && <p className="mb-3 hidden truncate px-3 text-sm text-ink-500 lg:block">{t('nav.hello', { name: user.fullName.split(' ')[0] })}</p>}
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:px-0">
            {items.map(({ href, label, Icon, exact }) => (
              <li key={href} className="shrink-0">
                <Link href={href} aria-current={isActive(href, exact) ? 'page' : undefined} className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${isActive(href, exact) ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100'} max-lg:border max-lg:border-ink-200 max-lg:bg-white`}>
                  <Icon className="size-4" aria-hidden />{label}
                </Link>
              </li>
            ))}
            <li className="shrink-0 lg:mt-3 lg:border-t lg:border-ink-100 lg:pt-3">
              <button type="button" onClick={signOut} className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 max-lg:border max-lg:border-ink-200 max-lg:bg-white" data-testid="sign-out">
                <LogOut className="size-4 rtl:rotate-180" aria-hidden />{t('nav.signOut')}
              </button>
            </li>
          </ul>
        </nav>
        <div className="min-w-0">
          <RequireAuth><DeletionBanner />{children}</RequireAuth>
        </div>
      </div>
    </div>
  );
}
