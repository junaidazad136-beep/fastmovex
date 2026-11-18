'use client';

import { Landmark } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import type { CashRefund } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { Spinner } from '../ui/Spinner';

const cleanIban = (v: string) => v.replace(/\s+/g, '').toUpperCase();

/**
 * Cash (COD) refunds go back by bank transfer: the customer gives the account here. Shown only when there is a cash
 * refund on the order. The IBAN is shown again only as its last 4 characters.
 */
export function CashRefunds({ refunds, orderNumber, currency, guestToken, onSaved }: { refunds: CashRefund[]; orderNumber: string; currency: string; guestToken?: string; onSaved: () => void }) {
  const t = useT();
  const money = useMoney();
  if (!refunds.length) return null;
  return (
    <section className="card p-4 text-sm" data-testid="cash-refunds">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Landmark className="size-4" aria-hidden />{t('cashRefund.title')}</h2>
      <p className="mb-3 text-ink-500">{t('cashRefund.intro')}</p>
      <ul className="space-y-3">
        {refunds.map((r) => (
          <li key={r.id} className="rounded-xl border border-ink-100 p-3">
            <p className="flex items-center justify-between font-semibold">
              <span>{money(r.amountMinor, { currency })}</span>
              <span className="text-xs font-medium text-ink-500">{t(`cashRefund.status.${r.status === 'SUCCEEDED' ? 'sent' : r.needsBank ? 'needsBank' : 'waiting'}`)}</span>
            </p>
            {r.ibanLast4 && <p className="mt-1 text-ink-600">{t('cashRefund.to', { holder: r.accountHolder ?? '', last4: r.ibanLast4 })}</p>}
            {r.status !== 'SUCCEEDED' && <BankForm refundId={r.id} orderNumber={orderNumber} guestToken={guestToken} change={!!r.ibanLast4} onSaved={onSaved} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BankForm({ refundId, orderNumber, guestToken, change, onSaved }: { refundId: string; orderNumber: string; guestToken?: string; change: boolean; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(!change);
  const [holder, setHolder] = useState('');
  const [iban, setIban] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <button type="button" className="link mt-1 text-xs" onClick={() => setOpen(true)}>{t('cashRefund.change')}</button>;
  const path = guestToken
    ? `/orders/guest/${encodeURIComponent(orderNumber)}/refunds/${refundId}/bank`
    : `/orders/${encodeURIComponent(orderNumber)}/refunds/${refundId}/bank`;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(path, { method: 'PUT', body: { accountHolder: holder.trim(), iban: cleanIban(iban) }, ...(guestToken && { auth: 'none' as const, headers: { 'x-order-token': guestToken } }) });
      toast({ tone: 'success', message: t('cashRefund.saved') });
      setOpen(false); setHolder(''); setIban('');
      onSaved();
    } catch (err) { setError(errorMessage(err, t)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="mt-2 space-y-2" data-testid="cash-refund-form" noValidate>
      <label className="block"><span className="label">{t('cashRefund.holder')}</span>
        <input className="input" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="name" required data-testid="cash-refund-holder" />
      </label>
      <label className="block"><span className="label">{t('cashRefund.iban')}</span>
        <input className="input font-mono" dir="ltr" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="QA00 XXXX 0000 0000 0000 0000 0000 0" autoComplete="off" required data-testid="cash-refund-iban" />
      </label>
      <p className="hint">{t('cashRefund.ibanHint')}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy || holder.trim().length < 2 || cleanIban(iban).length < 15} data-testid="cash-refund-save">{busy && <Spinner className="size-4" />}{t('cashRefund.save')}</button>
    </form>
  );
}
