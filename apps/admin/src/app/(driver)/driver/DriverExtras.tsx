'use client';

import clsx from 'clsx';
import { CheckCircle2, MapPin, MinusCircle, Navigation, Package, Phone, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Dialog, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { formatMoney } from '@/lib/format';
import { useToast } from '@/lib/state/toast';

export interface RefusableJob { id: string; orderNumber: string; items: { id: string; title: string; quantity: number; unitPriceMinor?: string }[]; cash: { amountMinor: string; currencyCode: string } | null }

const REFUSE_REASONS = ['Changed their mind', 'Wrong item or colour', 'Damaged in delivery', 'Did not order it'];

/** At the door the customer keeps part of the order: say what they gave back. Cash to collect goes down at once. */
export function RefuseItemsDialog({ job, onClose, onDone }: { job: RefusableJob | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState(REFUSE_REASONS[0]);
  const [busy, setBusy] = useState(false);
  if (!job) return null;
  const chosen = job.items.filter((i) => (qty[i.id] ?? 0) > 0);
  const all = job.items.every((i) => (qty[i.id] ?? 0) >= i.quantity);
  async function submit() {
    if (!job) return;
    setBusy(true);
    try {
      await api(`/courier/jobs/${job.id}/refuse-items`, { method: 'POST', body: { items: chosen.map((i) => ({ itemId: i.id, quantity: qty[i.id] })), reason } });
      toast.success('Saved. Keep the refused items in the van and enter the code for the rest.');
      setQty({});
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Customer refused some items" description={`${job.orderNumber} — they keep the rest`}
      footer={<><button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button><button type="button" className="btn-primary flex-[2]" disabled={!chosen.length || all || busy} onClick={submit} data-testid="refuse-submit">{busy ? <Spinner /> : null}Save</button></>}>
      <ul className="divide-y divide-ink-100" data-testid="refuse-items">
        {job.items.map((i) => {
          const n = qty[i.id] ?? 0;
          return (
            <li key={i.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1 text-sm"><span className="block font-medium">{i.title}</span><span className="text-ink-500">{i.quantity} in the order</span></span>
              <button type="button" className="btn-secondary px-3 py-2" onClick={() => setQty({ ...qty, [i.id]: Math.max(0, n - 1) })} disabled={n === 0} aria-label={`One less refused: ${i.title}`}>−</button>
              <span className={clsx('w-8 text-center text-lg font-bold tabular', n > 0 && 'text-danger-600')} data-testid="refused-qty">{n}</span>
              <button type="button" className="btn-secondary px-3 py-2" onClick={() => setQty({ ...qty, [i.id]: Math.min(i.quantity, n + 1) })} disabled={n === i.quantity} aria-label={`One more refused: ${i.title}`}>+</button>
            </li>
          );
        })}
      </ul>
      {all ? <p className="mt-2 text-sm text-danger-600">Everything refused? Close this and use “Problem” → “Customer refused the order”.</p> : null}
      <fieldset className="mt-3 grid grid-cols-2 gap-2">
        {REFUSE_REASONS.map((r) => (
          <label key={r} className={clsx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm', reason === r ? 'border-brand-600 bg-brand-50' : 'border-ink-200')}>
            <input type="radio" name="refuse-reason" checked={reason === r} onChange={() => setReason(r)} className="accent-brand-600" />{r}
          </label>
        ))}
      </fieldset>
      {job.cash ? <p className="mt-3 text-xs text-ink-500">Cash to collect now: {formatMoney(job.cash.amountMinor, job.cash.currencyCode)} — it goes down after you save.</p> : null}
    </Dialog>
  );
}

export interface PickupJob {
  id: string; status: 'ASSIGNED' | 'COLLECTED' | 'FAILED'; date: string; note: string | null; orderNumber: string; reason: string;
  item: { title: string; sku: string; quantity: number }; customer: { name: string | null; phone: string | null };
  address: { zone: string | null; street: string | null; building: string | null; unit: string | null; city: string | null; line1: string | null; mapUrl: string };
  failureReason: string | null;
}
const PICKUP_FAIL = ['Customer not answering', 'Customer not at home', 'Item not ready', 'Customer kept the item'];

/** Returns to collect from customers today: call, go, take the item, tap Collected (it then goes to the warehouse). */
export function PickupCards({ pickups, onChanged }: { pickups: PickupJob[]; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [failing, setFailing] = useState<PickupJob | null>(null);
  const [why, setWhy] = useState(PICKUP_FAIL[0]);
  if (!pickups.length) return null;
  const order = { ASSIGNED: 0, FAILED: 1, COLLECTED: 2 } as const;
  const sorted = [...pickups].sort((a, b) => order[a.status] - order[b.status]);
  async function act(p: PickupJob, path: 'collected' | 'failed', body: Record<string, unknown>, msg: string) {
    setBusy(p.id);
    try {
      await api(`/courier/pickups/${p.id}/${path}`, { method: 'POST', body });
      toast.success(msg);
      setFailing(null);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-label="Return pickups" data-testid="driver-pickups">
      <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-ink-500 uppercase">Return pickups · {pickups.length}</h2>
      <ul className="space-y-3">
        {sorted.map((p) => {
          const line = [p.address.unit, p.address.zone && `Zone ${p.address.zone}`, p.address.street && `St ${p.address.street}`, p.address.building && `Bldg ${p.address.building}`, p.address.line1, p.address.city].filter(Boolean).join(', ');
          return (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-violet-200 bg-white" data-testid="pickup-card">
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold">{p.customer.name ?? 'Customer'}</p><p className="font-mono text-xs text-ink-500">{p.orderNumber}</p></div>
                  <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', p.status === 'ASSIGNED' ? 'bg-violet-50 text-violet-700' : p.status === 'COLLECTED' ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-600')}>{p.status === 'ASSIGNED' ? 'To collect' : p.status === 'COLLECTED' ? 'Collected' : 'Not collected'}</span>
                </div>
                <p className="flex items-start gap-2 text-sm"><Package className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />{p.item.quantity}× {p.item.title} <span className="text-ink-500">· {p.reason}</span></p>
                <p className="flex items-start gap-2 text-sm text-ink-700"><MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />{line || '—'}</p>
                {p.note ? <p className="rounded-lg bg-sand-50 px-3 py-2 text-sm text-sand-800">{p.note}</p> : null}
                {p.failureReason ? <p className="text-sm text-danger-600">{p.failureReason}</p> : null}
              </div>
              {p.status === 'ASSIGNED' ? (
                <>
                  <div className="grid grid-cols-2 border-t border-ink-100 text-sm">
                    <a href={p.customer.phone ? `tel:${p.customer.phone}` : undefined} className="flex items-center justify-center gap-1.5 border-e border-ink-100 py-3 font-medium text-ink-700"><Phone className="size-4" aria-hidden />Call</a>
                    <a href={p.address.mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 py-3 font-medium text-ink-700"><Navigation className="size-4" aria-hidden />Map</a>
                  </div>
                  <div className="flex gap-2 border-t border-ink-100 bg-ink-25 p-3">
                    <button type="button" className="btn-secondary py-3" onClick={() => { setFailing(p); setWhy(PICKUP_FAIL[0]); }} disabled={!!busy}><XCircle className="size-5" aria-hidden />Problem</button>
                    <button type="button" className="btn-primary flex-1 py-3" onClick={() => act(p, 'collected', {}, 'Collected — bring it to the warehouse')} disabled={!!busy} data-testid="pickup-collected">{busy === p.id ? <Spinner /> : <CheckCircle2 className="size-5" aria-hidden />}Collected</button>
                  </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!failing} onClose={() => setFailing(null)} title="Could not collect" description={failing?.orderNumber}
        footer={<><button type="button" className="btn-secondary flex-1" onClick={() => setFailing(null)}>Cancel</button><button type="button" className="btn-danger flex-[2]" disabled={!!busy} onClick={() => failing && act(failing, 'failed', { reason: why }, 'Saved — the office will rearrange it')}><MinusCircle className="size-4" aria-hidden />Save</button></>}>
        <fieldset className="space-y-2">
          {PICKUP_FAIL.map((r) => (
            <label key={r} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm', why === r ? 'border-brand-600 bg-brand-50' : 'border-ink-200')}>
              <input type="radio" name="pickup-fail" checked={why === r} onChange={() => setWhy(r)} className="accent-brand-600" />{r}
            </label>
          ))}
        </fieldset>
      </Dialog>
    </section>
  );
}
