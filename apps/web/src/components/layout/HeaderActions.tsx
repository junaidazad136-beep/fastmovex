'use client';

import { Bell, Heart, ShoppingBag, User } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useSession } from '@/lib/state/session';
import { useWishlist } from '@/lib/state/wishlist';
import { paths } from '@/lib/urls';

function Badge({ n, testId }: { n: number; testId?: string }) {
  if (n <= 0) return null;
  return (
    <span data-testid={testId} className="tabular absolute -end-0.5 -top-0.5 flex min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold leading-[20px] text-white ring-2 ring-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function useUnreadCount() {
  const { status } = useSession();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (status !== 'user') { setUnread(0); return; }
    let stop = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ unread: number }>('/me/notifications/unread-count').then((r) => { if (!stop) setUnread(r.unread); }).catch(() => {});
    };
    load();
    const id = window.setInterval(load, 120_000);
    const onEvt = () => load();
    window.addEventListener('fmx:notifications-changed', onEvt);
    document.addEventListener('visibilitychange', onEvt);
    return () => { stop = true; window.clearInterval(id); window.removeEventListener('fmx:notifications-changed', onEvt); document.removeEventListener('visibilitychange', onEvt); };
  }, [status]);
  return unread;
}

export function HeaderActions() {
  const t = useT();
  const l = t.locale;
  const { status, user } = useSession();
  const { count } = useCart();
  const unread = useUnreadCount();
  const wishlist = useWishlist();
  const first = user?.fullName.split(' ')[0];

  return (
    <div className="flex items-center gap-0.5 sm:gap-2">
      <Link
        href={status === 'user' ? paths.account(l) : paths.login(l)}
        className="hidden items-center gap-2 rounded-xl px-2.5 py-2 text-start hover:bg-ink-100 md:flex"
        data-testid="header-account"
      >
        <User className="size-[22px] text-ink-700" aria-hidden />
        <span className="leading-tight">
          <span className="block text-[11px] text-ink-500">{status === 'user' ? t('nav.hello', { name: first ?? '' }) : t('nav.helloGuest')}</span>
          <span className="block text-sm font-semibold text-ink-800">{t('nav.myAccount')}</span>
        </span>
      </Link>
      {status === 'user' && (
        <Link href={paths.notifications(l)} className="relative hidden rounded-xl p-2.5 hover:bg-ink-100 sm:block" aria-label={`${t('nav.notifications')}${unread ? ` (${unread})` : ''}`}>
          <Bell className="size-[22px] text-ink-700" aria-hidden />
          <Badge n={unread} />
        </Link>
      )}
      <Link href={paths.wishlist(l)} className="relative rounded-xl p-2 hover:bg-ink-100 sm:p-2.5" aria-label={`${t('nav.wishlist')}${wishlist.count ? ` (${wishlist.count})` : ''}`} data-testid="header-wishlist">
        <Heart className="size-6 text-ink-900 sm:size-[22px]" strokeWidth={1.9} aria-hidden />
        {wishlist.count > 0 ? <span className="absolute end-1.5 top-1.5 size-2.5 rounded-full bg-brand-600 ring-2 ring-white sm:end-2 sm:top-2" aria-hidden /> : null}
      </Link>
      <Link href={paths.cart(l)} className="relative rounded-xl p-2 hover:bg-ink-100 sm:p-2.5" aria-label={`${t('nav.cart')}${count ? ` (${count})` : ''}`} data-testid="header-cart">
        <ShoppingBag className="size-6 text-ink-900 sm:size-[22px]" strokeWidth={1.9} aria-hidden />
        <Badge n={count} testId="cart-count" />
      </Link>
    </div>
  );
}
