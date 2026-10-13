'use client';

import { Bell, BellOff, Home, Package, ShoppingBag, Store, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { RequireAuth } from '../auth/RequireAuth';
import { BecomeSeller } from './BecomeSeller';
import { Onboarding } from './Onboarding';
import type { SellerMe, SellerSummary } from './types';

interface SellerCtx {
  me: SellerMe;
  summary: SellerSummary | null;
  reloadMe: () => Promise<void>;
  reloadSummary: () => Promise<void>;
  sound: boolean;
  toggleSound: () => void;
}
const Ctx = createContext<SellerCtx | null>(null);
export function useSeller(): SellerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeller outside SellerShell');
  return v;
}

const SOUND_KEY = 'fmx_seller_sound';
const SEEN_KEY = 'fmx_seller_seen_order';
const POLL_MS = 30_000;

function read(key: string) { try { return window.localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string | null) { try { if (v === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, v); } catch { /* storage off: still works this visit */ } }

/** A short "ding-dong" with the Web Audio API (no file to load). Needs one tap first (browsers block sound until then). */
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    audio ??= new AC();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no audio on this device */ }
}
function ding() {
  if (!audio) return;
  const now = audio.currentTime;
  for (const [i, f] of [880, 660, 880].entries()) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + i * 0.22);
    g.gain.exponentialRampToValueAtTime(0.35, now + i * 0.22 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2);
    o.connect(g).connect(audio.destination);
    o.start(now + i * 0.22);
    o.stop(now + i * 0.22 + 0.21);
  }
}

/** Seller Center frame: who you are as a seller decides what you see (join → application → your shop). */
export function SellerShell({ children }: { children: ReactNode }) {
  return <div className="container-page py-6"><RequireAuth><Gate>{children}</Gate></RequireAuth></div>;
}

function Gate({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const t = useT();
  const [me, setMe] = useState<SellerMe | null | 'none'>(null);
  const [failed, setFailed] = useState('');
  const loadMe = useCallback(async () => {
    try {
      setMe(await api<SellerMe>('/seller/me'));
      setFailed('');
    } catch (e) {
      // 403 "Seller account required" / "profile not found": this user has not applied yet
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setMe('none');
      else setFailed(errorMessage(e, t));
    }
  }, [t]);
  useEffect(() => { void loadMe(); }, [loadMe, user?.seller?.status]);

  if (failed) return <div className="card p-6 text-center"><p className="text-danger-600" role="alert">{failed}</p><button type="button" className="btn-secondary mt-4" onClick={() => void loadMe()}>{t('common.retry')}</button></div>;
  if (me === null) return <div className="space-y-4" aria-busy="true"><div className="skeleton h-8 w-56" /><div className="skeleton h-40" /></div>;
  if (me === 'none') return <BecomeSeller onCreated={loadMe} />;
  if (me.status !== 'APPROVED') return <Onboarding me={me} reload={loadMe} />;
  return <Approved me={me} reloadMe={loadMe}>{children}</Approved>;
}

function Approved({ me, reloadMe, children }: { me: SellerMe; reloadMe: () => Promise<void>; children: ReactNode }) {
  const t = useT();
  const l = t.locale;
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [summary, setSummary] = useState<SellerSummary | null>(null);
  const [sound, setSound] = useState(false);
  const title = useRef<string | null>(null);

  useEffect(() => { setSound(read(SOUND_KEY) === '1'); }, []);

  const reloadSummary = useCallback(async () => {
    const s = await api<SellerSummary>('/seller/orders/summary').catch(() => null);
    if (!s) return;
    setSummary(s);
    const newest = s.newestNew?.id ?? null;
    const seen = read(SEEN_KEY);
    if (newest && seen && newest !== seen) {
      // a new order since the last look: sound, a toast that opens it, and a dot in the tab title
      if (read(SOUND_KEY) === '1') ding();
      toast({ tone: 'success', message: t('seller.home.newOrder'), action: { label: t('seller.nav.orders'), onClick: () => router.push(paths.sellerOrder(l, newest)) } });
      if (typeof document !== 'undefined' && !document.title.startsWith('● ')) { title.current = document.title; document.title = `● ${document.title}`; }
    }
    if (newest) write(SEEN_KEY, newest);
  }, [toast, t, router, l]);

  useEffect(() => {
    void reloadSummary();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible' || read(SOUND_KEY) === '1') void reloadSummary(); }, POLL_MS);
    const clear = () => { if (title.current && document.visibilityState === 'visible') { document.title = title.current; title.current = null; } };
    document.addEventListener('visibilitychange', clear);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', clear); };
  }, [reloadSummary]);

  const toggleSound = useCallback(() => {
    const on = read(SOUND_KEY) !== '1';
    write(SOUND_KEY, on ? '1' : null);
    setSound(on);
    if (on) { unlockAudio(); ding(); }
  }, []);
  // browsers only play sound after a tap on the page: unlock on the first one
  useEffect(() => {
    if (!sound) return;
    const once = () => unlockAudio();
    window.addEventListener('pointerdown', once, { once: true });
    return () => window.removeEventListener('pointerdown', once);
  }, [sound]);

  const value = useMemo(() => ({ me, summary, reloadMe, reloadSummary, sound, toggleSound }), [me, summary, reloadMe, reloadSummary, sound, toggleSound]);
  const open = (summary?.orders.new ?? 0) + (summary?.orders.packing ?? 0);
  const items = [
    { href: paths.seller(l), label: t('seller.nav.home'), Icon: Home, exact: true },
    { href: paths.sellerOrders(l), label: t('seller.nav.orders'), Icon: ShoppingBag, badge: open },
    { href: paths.sellerProducts(l), label: t('seller.nav.products'), Icon: Package },
    { href: paths.sellerPayments(l), label: t('seller.nav.payments'), Icon: Wallet },
    { href: paths.sellerStore(l), label: t('seller.nav.store'), Icon: Store },
  ];
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <Ctx.Provider value={value}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label={t('seller.title')} className="min-w-0 lg:sticky lg:top-36 lg:self-start">
          <div className="mb-3 hidden items-center gap-2 px-3 lg:flex">
            <span className="rounded-md bg-brand-600 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">{t('seller.title')}</span>
          </div>
          <p className="mb-3 hidden truncate px-3 text-sm font-semibold text-ink-900 lg:block">{me.store?.name ?? me.businessName}</p>
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:px-0">
            {items.map(({ href, label, Icon, exact, badge }) => (
              <li key={href} className="shrink-0">
                <Link href={href} aria-current={active(href, exact) ? 'page' : undefined} className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${active(href, exact) ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100'} max-lg:border max-lg:border-ink-200 max-lg:bg-white`}>
                  <Icon className="size-4" aria-hidden />{label}
                  {!!badge && <span className="tabular min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white" data-testid="seller-open-orders">{badge}</span>}
                </Link>
              </li>
            ))}
            <li className="shrink-0 lg:mt-3 lg:border-t lg:border-ink-100 lg:pt-3">
              <button type="button" onClick={toggleSound} aria-pressed={sound} className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium ${sound ? 'text-success-700' : 'text-ink-600'} hover:bg-ink-100 max-lg:border max-lg:border-ink-200 max-lg:bg-white`} data-testid="seller-sound">
                {sound ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
                {sound ? t('seller.home.soundOn') : t('seller.home.soundOff')}
              </button>
            </li>
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </Ctx.Provider>
  );
}
