'use client';

import { ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { Empty, ListSkeleton, MoreButton, Tabs, useDate } from './kit';

type Status = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'IN_REPAIR' | 'RESOLVED';
type Resolution = 'REPAIRED' | 'REPLACED' | 'REFUNDED';
interface Claim {
  id: string; status: Status; resolution: Resolution | null; note: string | null; description: string; images: string[];
  warrantyEndsOn: string; dueAt: string | null; createdAt: string; overdue: boolean;
  orderItem: { productTitle: string; sku: string; imageUrl: string | null; order: { orderNumber: string } };
}
const TABS = ['REQUESTED', 'ACCEPTED', 'IN_REPAIR', 'ALL'] as const;
type Tab = (typeof TABS)[number];

/**
 * Warranty claims on the store's items (seller policy §8): accept (repair within 14 days) or reject with the reason the
 * customer reads; then "collected, in repair" and finally what was done — repaired, replaced or refunded.
 */
export function SellerWarranty() {
  const t = useT();
  const toast = useToast();
  const date = useDate();
  const [tab, setTab] = useState<Tab>('REQUESTED');
  const [items, setItems] = useState<Claim[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ c: Claim; to: 'REJECTED' | 'RESOLVED' } | null>(null);

  const load = useCallback(async (more?: string) => {
    try {
      const r = await api<{ items: Claim[]; nextCursor: string | null }>(`/seller/warranty?${new URLSearchParams({ ...(tab !== 'ALL' && { status: tab }), ...(more && { cursor: more }) })}`);
      setItems((x) => (more && x ? [...x, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
  }, [tab, toast, t]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  async function step(c: Claim, body: { status: Status; resolution?: Resolution; note?: string }) {
    setBusy(c.id);
    try {
      await api(`/seller/warranty/${c.id}/step`, { method: 'POST', body });
      toast({ tone: 'success', message: t('seller.warranty.saved') });
      setDialog(null);
      void load();
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5" data-testid="seller-warranty">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.warranty.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('seller.warranty.lead')}</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label={(k) => t(`seller.warranty.tabs.${k}`)} />
      {!items ? <ListSkeleton /> : items.length === 0 ? <Empty icon={<ShieldCheck className="size-6" aria-hidden />} title={t('seller.warranty.empty')} /> : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="card p-4" data-testid="seller-warranty-claim">
              <div className="flex gap-3">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">{c.orderItem.imageUrl && <Image src={c.orderItem.imageUrl} alt="" fill sizes="56px" className="object-contain p-1" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-semibold text-ink-900">{c.orderItem.productTitle}</p>
                    <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{t(`seller.warranty.status.${c.status}`)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{c.orderItem.order.orderNumber} · {date(c.createdAt)} · {t('seller.warranty.until', { date: date(c.warrantyEndsOn) })}</p>
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-800" dir="auto">{c.description}</p>
              {c.images.length > 0 ? (
                <div className="mt-2 flex gap-2">{c.images.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="relative size-16 overflow-hidden rounded-lg bg-ink-50"><Image src={u} alt="" fill sizes="64px" className="object-cover" /></a>)}</div>
              ) : c.status === 'REQUESTED' ? <p className="mt-1 text-xs font-medium text-warning-600">{t('seller.warranty.noPhotos')}</p> : null}
              {c.dueAt && (c.status === 'ACCEPTED' || c.status === 'IN_REPAIR') && (
                <p className={`mt-2 text-xs font-medium ${c.overdue ? 'text-danger-600' : 'text-ink-600'}`}>{c.overdue ? t('seller.warranty.overdue') : t('seller.warranty.due', { date: date(c.dueAt) })}</p>
              )}
              {c.note && <p className="mt-1 text-xs text-ink-600">{t('seller.returns.toldCustomer')}: <span dir="auto">{c.note}</span></p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {c.status === 'REQUESTED' && <>
                  <button type="button" className="btn-primary" disabled={!!busy || !c.images.length} onClick={() => step(c, { status: 'ACCEPTED' })} data-testid="warranty-accept">{busy === c.id && <Spinner className="size-4" />}{t('seller.warranty.accept')}</button>
                  <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => setDialog({ c, to: 'REJECTED' })}>{t('seller.warranty.reject')}</button>
                </>}
                {c.status === 'ACCEPTED' && <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => step(c, { status: 'IN_REPAIR' })}>{t('seller.warranty.collected')}</button>}
                {(c.status === 'ACCEPTED' || c.status === 'IN_REPAIR') && <button type="button" className="btn-primary" disabled={!!busy} onClick={() => setDialog({ c, to: 'RESOLVED' })}>{t('seller.warranty.resolve')}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <MoreButton cursor={cursor} busy={false} onMore={() => load(cursor!)} />
      <StepDialog d={dialog} busy={!!busy} onClose={() => setDialog(null)} onSend={(body) => step(dialog!.c, body)} />
    </div>
  );
}

function StepDialog({ d, busy, onClose, onSend }: { d: { c: Claim; to: 'REJECTED' | 'RESOLVED' } | null; busy: boolean; onClose: () => void; onSend: (b: { status: Status; resolution?: Resolution; note?: string }) => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState<Resolution>('REPAIRED');
  useEffect(() => { setNote(''); setResolution('REPAIRED'); }, [d]);
  if (!d) return null;
  const reject = d.to === 'REJECTED';
  return (
    <Dialog open onClose={onClose} title={reject ? t('seller.warranty.rejectTitle') : t('seller.warranty.resolveTitle')} closeLabel={t('common.close')}>
      {!reject && (
        <fieldset className="mb-3 space-y-2">
          {(['REPAIRED', 'REPLACED', 'REFUNDED'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="res" checked={resolution === r} onChange={() => setResolution(r)} />{t(`warranty.resolution.${r}`)}</label>
          ))}
        </fieldset>
      )}
      <label className="label" htmlFor="w-note">{reject ? t('seller.warranty.rejectReason') : t('seller.warranty.noteOptional')}</label>
      <textarea id="w-note" className="input min-h-20" dir="auto" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className={reject ? 'btn-danger' : 'btn-primary'} disabled={busy || (reject && note.trim().length < 5)}
          onClick={() => onSend(reject ? { status: 'REJECTED', note: note.trim() } : { status: 'RESOLVED', resolution, ...(note.trim() && { note: note.trim() }) })}>
          {busy && <Spinner className="size-4" />}{reject ? t('seller.warranty.reject') : t('seller.warranty.resolve')}
        </button>
      </div>
    </Dialog>
  );
}
