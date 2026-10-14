'use client';

import { PackageX, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { Empty, ListSkeleton, MoreButton, Tabs, useDate } from './kit';
import { useSeller } from './SellerShell';

type Status = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'REFUNDED';
interface SellerReturn {
  id: string; quantity: number; reason: string; images: string[]; status: Status; resolution: string | null; condition: string | null; inspectionNote: string | null;
  receivedAt: string | null; createdAt: string; pickup: { status: string; date: string } | null;
  orderItem: { productTitle: string; sku: string; quantity: number; unitPriceMinor: string; imageUrl: string | null; order: { orderNumber: string; currencyCode: string } };
}
const TABS = ['REQUESTED', 'APPROVED', 'ALL'] as const;
type Tab = (typeof TABS)[number];
const TONE: Record<Status, string> = {
  REQUESTED: 'bg-warning-50 text-warning-600', APPROVED: 'bg-sky-50 text-sky-700', RECEIVED: 'bg-sky-50 text-sky-700', REFUNDED: 'bg-success-50 text-success-700', REJECTED: 'bg-ink-100 text-ink-600',
};

/**
 * Returns customers asked for. Step 1: approve or refuse (with the reason the customer will read). Step 2: when the
 * item is back, say how it came back — sellable goes back into stock and the refund is started; damaged is refunded
 * but kept out of stock; not accepted (used, not what was sold) gets no refund and the customer is told why.
 */
export function SellerReturns() {
  const t = useT();
  const toast = useToast();
  const { summary, reloadSummary } = useSeller();
  const [tab, setTab] = useState<Tab>('REQUESTED');
  const [items, setItems] = useState<SellerReturn[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState<SellerReturn | null>(null);
  const [receive, setReceive] = useState<SellerReturn | null>(null);

  const load = useCallback(async (more?: string) => {
    setBusy(true);
    try {
      const r = await api<{ items: SellerReturn[]; nextCursor: string | null }>(`/seller/returns?${new URLSearchParams({ ...(tab !== 'ALL' && { status: tab }), ...(more && { cursor: more }) })}`);
      setItems((x) => (more && x ? [...x, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(false); }
  }, [tab, toast, t]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  async function act(id: string, path: string, body: unknown, ok: string) {
    try {
      await api(`/seller/returns/${id}/${path}`, { method: 'POST', body });
      toast({ tone: 'success', message: ok });
      setReject(null); setReceive(null);
      void load(); void reloadSummary();
      return true;
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); return false; }
  }

  return (
    <div className="space-y-5" data-testid="seller-returns">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.returns.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('seller.returns.lead')}</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label={(k) => t(`seller.returns.tabs.${k}`)} counts={{ REQUESTED: tab === 'REQUESTED' ? items?.length : undefined }} />
      {!items ? <ListSkeleton /> : items.length === 0 ? (
        <Empty icon={<RotateCcw className="size-6" aria-hidden />} title={t(`seller.returns.empty.${tab}`)} text={summary?.todo?.returns ? undefined : t('seller.returns.emptyHint')} />
      ) : (
        <ul className="space-y-3">
          {items.map((r) => <ReturnCard key={r.id} r={r} onApprove={() => act(r.id, 'decision', { decision: 'APPROVED' }, t('seller.returns.approvedToast'))} onReject={() => setReject(r)} onReceive={() => setReceive(r)} />)}
        </ul>
      )}
      <MoreButton cursor={cursor} busy={busy} onMore={() => load(cursor!)} />
      <RejectDialog r={reject} onClose={() => setReject(null)} onSend={(reason) => act(reject!.id, 'decision', { decision: 'REJECTED', resolution: reason }, t('seller.returns.rejectedToast'))} />
      <ReceiveDialog r={receive} onClose={() => setReceive(null)} onSend={(condition, note) => act(receive!.id, 'received', { condition, ...(note && { note }) }, t('seller.returns.receivedToast'))} />
    </div>
  );
}

function ReturnCard({ r, onApprove, onReject, onReceive }: { r: SellerReturn; onApprove: () => Promise<boolean>; onReject: () => void; onReceive: () => void }) {
  const t = useT();
  const date = useDate();
  const money = useMoney();
  const [busy, setBusy] = useState(false);
  return (
    <li className="card p-4" data-testid="seller-return">
      <div className="flex gap-3">
        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">{r.orderItem.imageUrl && <Image src={r.orderItem.imageUrl} alt="" fill sizes="56px" className="object-contain p-1" />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-semibold text-ink-900">{r.orderItem.productTitle}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[r.status]}`}>{t(`seller.returns.status.${r.status}`)}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            {t('seller.returns.meta', { qty: r.quantity, order: r.orderItem.order.orderNumber, date: date(r.createdAt) })} · <span className="tabular">{money(BigInt(r.orderItem.unitPriceMinor) * BigInt(r.quantity))}</span>
          </p>
        </div>
      </div>
      <p className="mt-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-800"><span className="font-semibold">{t('seller.returns.reason')}: </span><span dir="auto">{r.reason}</span></p>
      {r.images.length > 0 && (
        <div className="mt-2 flex gap-2">{r.images.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="relative size-16 overflow-hidden rounded-lg bg-ink-50"><Image src={u} alt="" fill sizes="64px" className="object-cover" /></a>)}</div>
      )}
      {r.pickup && <p className="mt-2 text-xs text-ink-600">{t('seller.returns.pickup', { date: date(r.pickup.date) })}</p>}
      {r.resolution && r.status !== 'REQUESTED' && <p className="mt-2 text-xs text-ink-600">{t('seller.returns.toldCustomer')}: <span dir="auto">{r.resolution}</span></p>}
      {r.inspectionNote && <p className="mt-1 text-xs text-ink-600">{t('seller.returns.inspection')}: <span dir="auto">{r.inspectionNote}</span></p>}
      {r.status === 'REQUESTED' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); await onApprove(); setBusy(false); }} data-testid="return-approve">{busy && <Spinner className="size-4" />}{t('seller.returns.approve')}</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onReject} data-testid="return-reject">{t('seller.returns.reject')}</button>
        </div>
      )}
      {r.status === 'APPROVED' && (
        <div className="mt-3">
          <button type="button" className="btn-primary" onClick={onReceive} data-testid="return-received"><PackageX className="size-4" aria-hidden />{t('seller.returns.markReceived')}</button>
        </div>
      )}
    </li>
  );
}

function RejectDialog({ r, onClose, onSend }: { r: SellerReturn | null; onClose: () => void; onSend: (reason: string) => Promise<boolean> }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); }, [r]);
  return (
    <Dialog open={!!r} onClose={onClose} title={t('seller.returns.rejectTitle')} closeLabel={t('common.close')}>
      <label htmlFor="ret-reason" className="label">{t('seller.returns.rejectReason')}</label>
      <textarea id="ret-reason" className="input min-h-24" dir="auto" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('seller.returns.rejectPlaceholder')} />
      <p className="hint">{t('seller.returns.rejectHint')}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn-danger" disabled={reason.trim().length < 5 || busy} onClick={async () => { setBusy(true); await onSend(reason.trim()); setBusy(false); }} data-testid="return-reject-send">{busy && <Spinner className="size-4" />}{t('seller.returns.reject')}</button>
      </div>
    </Dialog>
  );
}

const CONDITIONS = ['SELLABLE', 'DAMAGED', 'NOT_ACCEPTED'] as const;

function ReceiveDialog({ r, onClose, onSend }: { r: SellerReturn | null; onClose: () => void; onSend: (condition: string, note: string) => Promise<boolean> }) {
  const t = useT();
  const [condition, setCondition] = useState<(typeof CONDITIONS)[number]>('SELLABLE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCondition('SELLABLE'); setNote(''); }, [r]);
  const needsNote = condition !== 'SELLABLE';
  return (
    <Dialog open={!!r} onClose={onClose} title={t('seller.returns.receiveTitle')} closeLabel={t('common.close')}>
      <fieldset className="space-y-2">
        <legend className="label">{t('seller.returns.howBack')}</legend>
        {CONDITIONS.map((c) => (
          <label key={c} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${condition === c ? 'border-brand-600 bg-brand-50' : 'border-ink-200'}`}>
            <input type="radio" name="cond" className="mt-0.5 accent-brand-600" checked={condition === c} onChange={() => setCondition(c)} />
            <span><span className="block font-semibold">{t(`seller.returns.cond.${c}`)}</span><span className="text-ink-600">{t(`seller.returns.condHint.${c}`)}</span></span>
          </label>
        ))}
      </fieldset>
      {needsNote && (
        <div className="mt-3">
          <label htmlFor="ret-note" className="label">{t('seller.returns.whatWrong')}</label>
          <textarea id="ret-note" className="input min-h-20" dir="auto" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={busy || (needsNote && note.trim().length < 5)} onClick={async () => { setBusy(true); await onSend(condition, note.trim()); setBusy(false); }} data-testid="return-received-send">{busy && <Spinner className="size-4" />}{t('seller.returns.confirm')}</button>
      </div>
    </Dialog>
  );
}
