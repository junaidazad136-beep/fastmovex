'use client';

import { Banknote } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';
import { useSeller } from './SellerShell';
import { BankForm, LogoBlock, StoreProfileForm } from './StoreForms';
import type { SellerBalance, SellerPayout, StatementRow } from './types';
import { HolidayCard } from './Health';

const PAYOUT_TONE: Record<SellerPayout['status'], string> = {
  REQUESTED: 'bg-sky-50 text-sky-700', APPROVED: 'bg-sky-50 text-sky-700', PROCESSING: 'bg-sky-50 text-sky-700', PAID: 'bg-success-50 text-success-700', REJECTED: 'bg-danger-50 text-danger-600',
};

export function SellerPayments() {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const toast = useToast();
  const { me } = useSeller();
  const [b, setB] = useState<SellerBalance | null>(null);
  const [payouts, setPayouts] = useState<SellerPayout[]>([]);
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [bal, ps, st] = await Promise.all([
      api<SellerBalance>('/seller/finance/balance'),
      api<SellerPayout[]>('/seller/payouts'),
      api<{ items: StatementRow[] }>('/seller/finance/statement'),
    ]);
    setB(bal); setPayouts(ps); setRows(st.items);
  }, []);
  useEffect(() => { void load().catch((e) => toast({ tone: 'error', message: errorMessage(e, t) })); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function request() {
    if (!b) return;
    setBusy(true);
    try {
      await api('/seller/payouts', { method: 'POST', body: { amountMinor: b.requestableMinor } });
      toast({ tone: 'success', message: t('seller.pay.requested') });
      await load();
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(false); }
  }

  const canRequest = !!b && !!me.ibanLast4 && BigInt(b.requestableMinor) >= BigInt(b.minimumPayoutMinor) && BigInt(b.requestableMinor) > 0n;
  const date = (d: string) => new Date(d).toLocaleDateString(l === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="space-y-5" data-testid="seller-payments">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('seller.pay.title')}</h1>
      <section className="card p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Amount label={t('seller.pay.available')} value={b && money(b.availableMinor)} strong />
          <Amount label={t('seller.pay.pending')} value={b && money(b.pendingMinor)} />
          <Amount label={t('seller.pay.inPayout')} value={b && money(b.inPayoutMinor)} />
          <Amount label={t('seller.pay.paidOut')} value={b && money(b.paidOutMinor)} />
        </dl>
        <p className="hint mt-3">{t('seller.pay.pendingHint')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={!canRequest || busy} onClick={() => void request()} data-testid="request-payout">{busy ? <Spinner /> : <Banknote className="size-4" aria-hidden />}{t('seller.pay.request')}{b && canRequest ? ` · ${money(b.requestableMinor)}` : ''}</button>
          {b && <span className="text-sm text-ink-500">{t('seller.pay.minimum', { amount: money(b.minimumPayoutMinor) })}</span>}
        </div>
        {!me.ibanLast4 && <p className="mt-3 text-sm font-medium text-warning-600"><Link href={paths.sellerStore(l)} className="link">{t('seller.pay.noBank')}</Link></p>}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">{t('seller.pay.payouts')}</h2>
        {payouts.length === 0 ? <p className="text-sm text-ink-500">{t('seller.pay.empty')}</p> : (
          <ul className="divide-y divide-ink-100 text-sm">
            {payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-600">{date(p.requestedAt)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYOUT_TONE[p.status]}`}>{t(`seller.pay.status.${p.status}`)}</span>
                <span className="tabular font-semibold">{money(p.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">{t('seller.pay.statement')}</h2>
        {rows.length === 0 ? <p className="text-sm text-ink-500">{t('seller.pay.empty')}</p> : (
          <ul className="divide-y divide-ink-100 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0"><p className="truncate text-ink-800">{r.transaction.description ?? r.transaction.type}</p><p className="text-xs text-ink-500">{date(r.createdAt)}</p></div>
                <span className={`tabular shrink-0 font-semibold ${r.amountMinor.startsWith('-') ? 'text-danger-600' : 'text-success-700'}`} dir="ltr">{r.amountMinor.startsWith('-') ? '' : '+'}{money(r.amountMinor, { currency: r.account.currencyCode })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Amount({ label, value, strong }: { label: string; value: string | null | false; strong?: boolean }) {
  return <div><dt className="text-sm text-ink-500">{label}</dt><dd className={`tabular text-lg font-bold ${strong ? 'text-success-700' : ''}`}>{value || '–'}</dd></div>;
}

export function SellerStore() {
  const t = useT();
  const { me, reloadMe } = useSeller();
  return (
    <div className="space-y-5" data-testid="seller-store">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('seller.store.title')}</h1>
      {me.status === 'APPROVED' && <HolidayCard />}
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">{t('seller.store.profile')}</h2>
        <LogoBlock me={me} onDone={reloadMe} />
        <StoreProfileForm me={me} onSaved={reloadMe} />
        <p className="hint">{t('seller.store.legal')}</p>
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">{t('seller.onboarding.stepBank')}</h2>
        <BankForm me={me} onSaved={reloadMe} />
      </section>
    </div>
  );
}
