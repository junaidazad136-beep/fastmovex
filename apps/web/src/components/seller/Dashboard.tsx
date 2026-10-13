'use client';

import { AlertTriangle, ArrowRight, Bell, BellOff, ExternalLink, Package, PackageCheck, Plus, ShoppingBag, Truck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useMoney } from '@/lib/state/shop';
import { paths } from '@/lib/urls';
import { useSeller } from './SellerShell';
import type { SellerBalance } from './types';

export function SellerDashboard() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const { user } = useSession();
  const { me, summary, sound, toggleSound } = useSeller();
  const [balance, setBalance] = useState<SellerBalance | null>(null);
  useEffect(() => { api<SellerBalance>('/seller/finance/balance').then(setBalance).catch(() => setBalance(null)); }, []);

  const o = summary?.orders;
  const p = summary?.products;
  const tiles = [
    { label: t('seller.home.newOrders'), value: o?.new, href: `${paths.sellerOrders(l)}?tab=new`, Icon: ShoppingBag, hot: (o?.new ?? 0) > 0, id: 'new' },
    { label: t('seller.home.packing'), value: o?.packing, href: `${paths.sellerOrders(l)}?tab=packing`, Icon: Package, id: 'packing' },
    { label: t('seller.home.ready'), value: o?.ready, href: `${paths.sellerOrders(l)}?tab=ready`, Icon: PackageCheck, id: 'ready' },
    { label: t('seller.home.onTheWay'), value: o?.onTheWay, href: `${paths.sellerOrders(l)}?tab=shipped`, Icon: Truck, id: 'shipped' },
  ];
  return (
    <div className="space-y-6" data-testid="seller-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-500">{t('seller.home.hello', { name: user?.fullName.split(' ')[0] ?? '' })}</p>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{me.store?.name ?? me.businessName}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.store && <Link href={paths.store(l, me.store.slug)} className="btn-secondary px-3 py-2 text-sm"><ExternalLink className="size-4" aria-hidden />{t('seller.home.viewShop')}</Link>}
          <Link href={paths.sellerNewProduct(l)} className="btn-primary px-3 py-2 text-sm"><Plus className="size-4" aria-hidden />{t('seller.home.addProduct')}</Link>
        </div>
      </div>

      {!sound && (
        <button type="button" onClick={toggleSound} className="flex w-full items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-start text-sm font-semibold text-brand-800 hover:bg-brand-100">
          <BellOff className="size-5 shrink-0" aria-hidden /><span className="flex-1">{t('seller.home.soundOff')}</span><Bell className="size-5" aria-hidden />
        </button>
      )}

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ label, value, href, Icon, hot, id }) => (
          <li key={id}>
            <Link href={href} className={`flex h-full flex-col gap-2 rounded-2xl border p-4 transition hover:shadow-sm ${hot ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-100 bg-white'}`} data-testid={`tile-${id}`}>
              <Icon className={`size-5 ${hot ? 'text-white' : 'text-brand-600'}`} aria-hidden />
              <span className="tabular text-3xl font-extrabold leading-none">{value ?? '–'}</span>
              <span className={`text-sm ${hot ? 'text-white/90' : 'text-ink-600'}`}>{label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">{t('seller.nav.products')}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label={t('seller.home.live')} value={p?.live} />
            <Stat label={t('seller.home.inReview')} value={p?.inReview} />
            <Stat label={t('seller.products.status.REJECTED')} value={p?.rejected} warn={(p?.rejected ?? 0) > 0} />
            <Stat label={t('seller.home.lowStock')} value={p?.lowStock} warn={(p?.lowStock ?? 0) > 0} />
          </dl>
          <Link href={paths.sellerProducts(l)} className="link mt-4 inline-flex items-center gap-1 text-sm">{t('seller.nav.products')}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">{t('seller.nav.payments')}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-500">{t('seller.home.available')}</dt><dd className="tabular text-xl font-bold text-success-700">{balance ? money(balance.availableMinor) : '–'}</dd></div>
            <div><dt className="text-ink-500">{t('seller.home.pending')}</dt><dd className="tabular text-xl font-bold">{balance ? money(balance.pendingMinor) : '–'}</dd></div>
          </dl>
          <Link href={paths.sellerPayments(l)} className="link mt-4 inline-flex items-center gap-1 text-sm">{t('seller.nav.payments')}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">{t('seller.home.howItWorks')}</h2>
        <ol className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <li key={n} className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{n}</span><span className="text-ink-700">{t(`seller.home.step${n}` as 'seller.home.step1')}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | undefined; warn?: boolean }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className={`tabular flex items-center gap-1 text-xl font-bold ${warn ? 'text-warning-600' : ''}`}>{warn && <AlertTriangle className="size-4" aria-hidden />}{value ?? '–'}</dd>
    </div>
  );
}
