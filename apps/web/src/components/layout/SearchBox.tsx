'use client';

import { ArrowRight, Camera, Clock, LayoutGrid, Mic, Package, Search, Tag, TrendingUp } from 'lucide-react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import type { Suggestions } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { BarcodeScanner } from '../search/BarcodeScanner';
import { startNav } from './NavProgress';

/* eslint-disable @typescript-eslint/no-explicit-any -- the Web Speech API is not in the DOM typings yet */
type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; abort(): void; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };
function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Kind = 'recent' | 'popular' | 'query' | 'product' | 'category' | 'brand' | 'all';
type Option = { key: string; label: string; href: string; kind: Kind; term?: string; imageUrl?: string | null; price?: string; sub?: string; soldOut?: boolean };

const RECENT_KEY = 'fmx.recentSearches';
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch { return []; }
}
function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* private mode: nothing to remember */ }
}
/** Remembered on this device only, newest first. */
function rememberSearch(term: string) {
  const t = term.trim();
  if (t.length < 2) return;
  saveRecent([t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())]);
}

/** Search with type-ahead (ARIA combobox). Suggestions are fetched after a short pause in typing. */
export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const t = useT();
  const locale = t.locale;
  const money = useMoney();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const listId = useId();
  const [q, setQ] = useState(() => (pathname.endsWith('/search') ? params.get('q') ?? '' : ''));
  const [data, setData] = useState<Suggestions | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLFormElement>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [popular, setPopular] = useState<string[] | null>(null);
  const [voiceOk, setVoiceOk] = useState(false);
  const [listening, setListening] = useState(false);
  const [scanning, setScanning] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  // only after mount: the server cannot know whether this browser understands speech
  useEffect(() => { setVoiceOk(!!speechRecognition()); return () => recognition.current?.abort(); }, []);

  function voice() {
    const SR = speechRecognition();
    if (!SR) return;
    if (listening) { recognition.current?.abort(); return; }
    const r = new SR();
    r.lang = locale === 'ar' ? 'ar-QA' : 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = String(e.results?.[0]?.[0]?.transcript ?? '').trim();
      if (text) { setQ(text); go(paths.search(locale, { q: text }), text); }
    };
    r.onerror = (e) => { if (e?.error !== 'aborted' && e?.error !== 'no-speech') toast({ tone: 'error', message: t('search.voiceFailed') }); };
    r.onend = () => setListening(false);
    recognition.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

  useEffect(() => {
    if (pathname.endsWith('/search')) setQ(params.get('q') ?? '');
  }, [pathname, params]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setData(null); return; }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      api<Suggestions>(`/search/suggest?q=${encodeURIComponent(term)}`, { auth: 'none', signal: ctrl.signal })
        .then((d) => { setData(d); setActive(-1); })
        .catch(() => { /* suggestions are a nicety; the search button still works */ });
    }, 180);
    return () => { window.clearTimeout(id); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function onFocus() {
    setOpen(true);
    setRecent(readRecent());
    if (popular === null) {
      setPopular([]);
      api<{ queries: string[] }>('/search/popular', { auth: 'none' }).then((d) => setPopular(d.queries)).catch(() => { /* optional */ });
    }
  }

  const typing = q.trim().length >= 2;
  const options = useMemo<Option[]>(() => {
    const searchFor = (kind: Kind, term: string) => ({ key: `${kind}-${term}`, label: term, href: paths.search(locale, { q: term }), kind, term });
    if (!typing) {
      const shown = new Set(recent.map((r) => r.toLowerCase()));
      return [
        ...recent.map((r) => searchFor('recent', r)),
        ...(popular ?? []).filter((p) => !shown.has(p.toLowerCase())).slice(0, 6).map((p) => searchFor('popular', p)),
      ];
    }
    if (!data) return [];
    return [
      ...(data.queries ?? []).slice(0, 4).map((term) => searchFor('query', term)),
      ...data.categories.slice(0, 3).map((c) => ({ key: `c-${c.slug}`, label: pick(locale, c.name, c.nameAr), href: paths.category(locale, c.slug), kind: 'category' as const })),
      ...data.brands.slice(0, 3).map((b) => ({ key: `b-${b.slug}`, label: pick(locale, b.name, b.nameAr), href: paths.brand(locale, b.slug), kind: 'brand' as const })),
      ...data.products.slice(0, 6).map((p) => ({
        key: `p-${p.slug}`, label: pick(locale, p.title, p.titleAr), href: paths.product(locale, p.slug), kind: 'product' as const,
        imageUrl: p.imageUrl, price: p.priceMinor ? money(p.priceMinor) : undefined, sub: p.category ? pick(locale, p.category, p.categoryAr) : undefined, soldOut: p.inStock === false,
      })),
      // the whole result list, always last (Enter does the same)
      { key: 'all', label: t('search.viewAll', { q: q.trim() }), href: paths.search(locale, { q: q.trim() }), kind: 'all' as const, term: q.trim() },
    ];
  }, [data, locale, typing, recent, popular, money, q, t]);

  const showList = open && options.length > 0;

  function go(href: string, term?: string) {
    if (term) rememberSearch(term);
    setOpen(false);
    startNav();
    router.push(href);
  }

  function clearRecent() {
    saveRecent([]);
    setRecent([]);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (active >= 0 && options[active]) return go(options[active].href, options[active].term);
    const term = q.trim();
    go(paths.search(locale, term ? { q: term } : {}), term);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!showList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  }

  const Icon = { recent: Clock, popular: TrendingUp, query: Search, product: Package, category: LayoutGrid, brand: Tag, all: ArrowRight };
  const groupLabel: Record<Kind, string> = { recent: t('search.recent'), popular: t('search.popular'), query: t('search.searches'), product: t('search.products'), category: t('search.categories'), brand: t('search.brands'), all: '' };

  return (
    <>
    {/* outside the search form: the scanner has a form of its own */}
    {scanning ? <BarcodeScanner open={scanning} onClose={() => setScanning(false)} /> : null}
    <form ref={boxRef} role="search" onSubmit={onSubmit} className="relative w-full">
      <label htmlFor={`${listId}-input`} className="sr-only">{t('search.label')}</label>
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-800 sm:start-4 sm:size-[22px]" strokeWidth={2} aria-hidden />
      <input
        id={`${listId}-input`}
        type="search"
        name="q"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        placeholder={listening ? t('search.listening') : t('search.placeholder')}
        autoComplete="off"
        autoFocus={autoFocus}
        enterKeyHint="search"
        maxLength={100}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className="h-11 w-full rounded-2xl border border-ink-200 bg-white pe-24 ps-11 text-[14px] sm:h-12 sm:ps-12 sm:text-[15px] text-ink-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)] placeholder:text-ink-500 transition focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-600/15 [&::-webkit-search-cancel-button]:hidden"
      />
      <button type="submit" className="sr-only">{t('search.submit')}</button>
      <div className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center">
        {voiceOk ? (
          <button type="button" onClick={voice} aria-label={t('search.voice')} aria-pressed={listening} className={`flex size-9 items-center justify-center rounded-xl transition ${listening ? 'animate-pulse bg-brand-50 text-brand-600' : 'text-ink-800 hover:bg-ink-100'}`} data-testid="voice-search">
            <Mic className="size-5 sm:size-[21px]" strokeWidth={2} aria-hidden />
          </button>
        ) : null}
        {voiceOk ? <span className="mx-1 h-6 w-px bg-ink-200" aria-hidden /> : null}
        <button type="button" onClick={() => setScanning(true)} aria-label={t('search.scan')} className="flex size-9 items-center justify-center rounded-xl text-ink-800 hover:bg-ink-100" data-testid="barcode-search">
          <Camera className="size-5 sm:size-[21px]" strokeWidth={2} aria-hidden />
        </button>
      </div>
      {showList && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-100 bg-white py-1.5 shadow-[var(--shadow-pop)]">
          {options.map((o, i) => {
            const I = Icon[o.kind];
            const first = i === 0 || options[i - 1].kind !== o.kind;
            return (
              <li key={o.key} role="presentation">
                {first && o.kind !== 'all' && (
                  <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                    {groupLabel[o.kind]}
                    {o.kind === 'recent' && (
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); clearRecent(); }} className="normal-case tracking-normal text-brand-700 hover:underline" data-testid="search-clear-recent">{t('search.clearRecent')}</button>
                    )}
                  </div>
                )}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); go(o.href, o.term); }}
                  data-testid={`search-option-${o.kind}`}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-3 px-4 text-sm ${o.kind === 'product' ? 'py-1.5' : 'py-2'} ${o.kind === 'all' ? 'mt-1 border-t border-ink-100 pt-2.5 font-medium text-brand-700' : ''} ${i === active ? 'bg-ink-50 text-brand-700' : 'text-ink-800'}`}
                >
                  {o.kind === 'product' ? (
                    <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-ink-50">
                      {o.imageUrl ? <Image src={o.imageUrl} alt="" fill sizes="44px" className="object-contain p-0.5" /> : <Package className="m-auto mt-3 size-4 text-ink-300" aria-hidden />}
                    </span>
                  ) : (
                    <I className="size-4 shrink-0 text-ink-400" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.sub ? <span className="block truncate text-xs text-ink-400">{o.sub}</span> : null}
                  </span>
                  {o.kind === 'product' && (o.price || o.soldOut) ? (
                    <span className={`shrink-0 text-end text-xs font-semibold tabular ${o.soldOut ? 'text-ink-400' : 'text-ink-900'}`}>{o.soldOut ? t('search.outOfStock') : o.price}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </form>
    </>
  );
}
