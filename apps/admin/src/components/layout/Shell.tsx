'use client';

import clsx from 'clsx';
import { ExternalLink, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NoAccess, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { initials } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { AlertsBell } from './AlertsBell';
import { LogoMark, Logo } from './Logo';
import { NAV, navItemFor, type SummaryKey } from './nav';
import { useConfig } from './Providers';

type Summary = Partial<Record<SummaryKey, number>>;

export function Shell({ children }: { children: ReactNode }) {
  const { status, user, can, signOut, isDriver, driverOnly, mustSetUpTwoFactor } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const { storefrontUrl } = useConfig();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary>({});

  useEffect(() => {
    if (status === 'signed-out') router.replace(`/login${pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''}`);
    if (status === 'signed-in' && driverOnly) router.replace('/driver'); // drivers only have the driver page
    // two-step sign-in is required for staff and this session has not got it: only the Security page works until it is on
    if (status === 'signed-in' && !driverOnly && mustSetUpTwoFactor && pathname !== '/security') router.replace('/security');
  }, [status, pathname, router, driverOnly, mustSetUpTwoFactor]);

  useEffect(() => setOpen(false), [pathname]);

  // Counters for the menu badges ("12 orders to ship"), refreshed every minute while the panel is open.
  useEffect(() => {
    if (status !== 'signed-in' || driverOnly || mustSetUpTwoFactor) return;
    let stop = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      api<Summary>('/admin/dashboard/summary').then((s) => !stop && setSummary(s)).catch(() => undefined);
    };
    load();
    const id = setInterval(load, 60_000);
    window.addEventListener('fmx:summary-stale', load);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('fmx:summary-stale', load);
    };
  }, [status, driverOnly, mustSetUpTwoFactor]);

  if (status !== 'signed-in' || !user || driverOnly || (mustSetUpTwoFactor && pathname !== '/security')) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-ink-500" role="status">
        <Spinner className="size-6" /> <span className="sr-only">Loading</span>
      </div>
    );
  }

  const current = navItemFor(pathname);
  const allowed = !current || can(...current.perms);
  const groups = mustSetUpTwoFactor ? [] : NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(...i.perms)) })).filter((g) => g.items.length > 0);

  const sidebar = (
    <nav aria-label="Admin" className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/" aria-label="Dashboard"><Logo /></Link>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label ? <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{g.label}</p> : null}
            <ul className="space-y-0.5">
              {g.items.map((i) => {
                const active = current?.href === i.href;
                const count = i.badge ? summary[i.badge] : undefined;
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
                      )}
                    >
                      <i.icon className={clsx('size-[18px] shrink-0', active ? 'text-brand-600' : 'text-ink-400')} aria-hidden />
                      <span className="flex-1 truncate">{i.label}</span>
                      {count ? <span className="rounded-full bg-brand-600 px-1.5 py-px text-[11px] font-semibold text-white tabular">{count > 99 ? '99+' : count}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-ink-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="no-print fixed inset-y-0 start-0 z-30 hidden w-64 border-e border-ink-100 bg-white lg:block">{sidebar}</aside>

      {open ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-ink-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85%] bg-white shadow-[var(--shadow-pop)]">
            <button type="button" className="absolute end-3 top-4 rounded-lg p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:ps-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-100 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" className="-ms-1 rounded-lg p-2 text-ink-700 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" aria-hidden />
          </button>
          <Link href="/" className="lg:hidden" aria-label="Dashboard"><LogoMark /></Link>
          <div className="flex-1" />
          {isDriver ? <Link href="/driver" className="btn-ghost btn-sm">Driver page</Link> : null}
          {!mustSetUpTwoFactor ? <AlertsBell /> : null}
          <Link href="/security" className="btn-ghost btn-sm" data-testid="my-security"><ShieldCheck className="size-4" aria-hidden /> <span className="hidden sm:inline">Security</span></Link>
          <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm hidden sm:inline-flex">
            View store <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <div className="flex items-center gap-2.5 border-s border-ink-100 ps-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700" aria-hidden>{initials(user.fullName)}</span>
            <div className="hidden min-w-0 leading-tight md:block">
              <p className="truncate text-sm font-semibold text-ink-900">{user.fullName}</p>
              <p className="truncate text-xs text-ink-500">{user.roles.filter((r) => r !== 'CUSTOMER').map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}</p>
            </div>
            <button type="button" onClick={() => void signOut()} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label="Sign out" title="Sign out">
              <LogOut className="size-[18px]" aria-hidden />
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">{allowed ? children : <NoAccess />}</main>
      </div>
    </div>
  );
}

/** Tell the shell that a change affects the menu counters (e.g. an order was shipped). */
export function summaryStale() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fmx:summary-stale'));
}
