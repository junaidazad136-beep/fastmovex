import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import type { CategoryNode, Market } from '@/lib/api/types';
import type { T } from '@/lib/i18n';
import { paths, pick } from '@/lib/urls';
import { Logo } from '../ui/Logo';
import { HeaderActions } from './HeaderActions';
import { LocaleSwitch } from './LocaleSwitch';
import { LocationButton } from './LocationButton';
import { SearchBox } from './SearchBox';

/** 🇶🇦 from "QA" (regional indicator letters). */
function flagOf(code: string): string {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function Header({ t, market, categories }: { t: T; market: Market; categories: CategoryNode[] }) {
  const l = t.locale;
  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        {t('nav.skipToContent')}
      </a>
      <div className="hidden bg-brand-700 text-[12.5px] text-white/90 sm:block">
        <div className="container-page flex h-9 items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" aria-hidden />
            {t('nav.deliveringIn', { country: pick(l, market.name, market.nameAr) })}
            <span className="mx-2 text-white/40">·</span>
            {market.currency.code}
          </span>
          <nav className="flex items-center gap-3" aria-label={t('nav.help')}>
            <Link href={paths.help(l)} className="hover:text-white hover:underline">{t('nav.help')}</Link>
            <Link href={paths.track(l)} className="hover:text-white hover:underline">{t('nav.track')}</Link>
            <Suspense fallback={null}><LocaleSwitch /></Suspense>
          </nav>
        </div>
      </div>
      <div className="container-page flex h-[68px] items-center gap-2 sm:h-[72px] sm:gap-5">
        <Link href={paths.home(l)} className="shrink-0" aria-label={`${t('meta.siteName')} — ${t('common.home')}`}>
          <Logo label={t('meta.siteName')} tagline={t('meta.tagline')} />
        </Link>
        <div className="hidden flex-1 md:block">
          <Suspense fallback={<div className="h-12 rounded-2xl bg-ink-50" />}><SearchBox /></Suspense>
        </div>
        <div className="ms-auto flex items-center gap-0.5 md:ms-0 sm:gap-1">
          <LocationButton country={pick(l, market.name, market.nameAr)} flag={flagOf(market.code)} />
          <HeaderActions />
        </div>
      </div>
      <div className="container-page pb-3 md:hidden">
        <Suspense fallback={<div className="h-12 rounded-2xl bg-ink-50" />}><SearchBox /></Suspense>
      </div>
      <nav aria-label={t('nav.categories')} className="hidden border-t border-ink-100 md:block">
        <ul className="container-page no-scrollbar flex h-11 items-center gap-1 overflow-x-auto text-[13.5px]">
          <li>
            <Link href={paths.search(l)} className="whitespace-nowrap rounded-lg px-2.5 py-1.5 font-semibold text-brand-700 hover:bg-brand-50">{t('nav.allCategories')}</Link>
          </li>
          <li>
            <Link href={paths.offers(l)} className="whitespace-nowrap rounded-lg px-2.5 py-1.5 font-semibold text-deal-600 hover:bg-danger-50">{t('nav.offers')}</Link>
          </li>
          {categories.slice(0, 14).map((c) => (
            <li key={c.slug}>
              <Link href={paths.category(l, c.slug)} className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-ink-700 hover:bg-ink-100 hover:text-ink-900">
                {pick(l, c.name, c.nameAr)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
