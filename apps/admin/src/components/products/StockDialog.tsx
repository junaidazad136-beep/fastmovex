'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Dialog, Field, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, humanize } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { useApi } from '@/lib/use-api';

export interface StockTarget {
  variantId: string;
  label: string;
  sku: string;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
}

interface Movement { id: string; qtyDelta: number; reason: string; refType: string | null; note: string | null; createdAt: string; actorName: string | null; warehouseId?: string | null }
interface Shelf { id: string; code: string; name: string; isDefault: boolean; isActive: boolean; onHand: number; free: number }

const REASON_LABEL: Record<string, string> = {
  RESTOCK: 'Restock', ADJUSTMENT: 'Adjustment', COMMIT: 'Sold', RELEASE: 'Order cancelled', RETURN: 'Returned', RESERVE: 'Reserved', INITIAL: 'Opening stock',
  TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', DAMAGED: 'Damaged', EXPIRED: 'Expired', LOST: 'Lost / stolen', FOUND: 'Found', COUNT: 'Stocktake',
};

/** Why stock changes: in from a supplier or found; out because damaged, expired, lost; or a plain correction. */
const ADD_REASONS = [['RESTOCK', 'Received (supplier delivery)'], ['FOUND', 'Found (was missing)'], ['ADJUSTMENT', 'Correction']] as const;
const REMOVE_REASONS = [['DAMAGED', 'Damaged'], ['EXPIRED', 'Expired'], ['LOST', 'Lost or stolen'], ['ADJUSTMENT', 'Correction']] as const;

/**
 * Change stock by an amount ("received 20", "2 damaged") or set the counted number.
 * Every change is recorded with who made it; the history is shown underneath.
 */
export function StockDialog({ target, onClose, onSaved, canAdjust }: { target: StockTarget | null; onClose: () => void; onSaved: (next: { onHand: number; lowStockThreshold: number }) => void; canAdjust: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string>('RESTOCK');
  const [expiresOn, setExpiresOn] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useApi<Movement[]>(target ? `/admin/variants/${target.variantId}/stock` : null);
  const shelves = useApi<Shelf[]>(target ? `/admin/variants/${target.variantId}/warehouses` : null);
  const [warehouseId, setWarehouseId] = useState('');
  const open = (shelves.data ?? []).filter((w) => w.isActive);
  const shelf = open.find((w) => w.id === warehouseId) ?? open.find((w) => w.isDefault) ?? open[0];

  useEffect(() => {
    if (target) {
      setMode('add');
      setQty('');
      setNote('');
      setReason('RESTOCK');
      setExpiresOn('');
      setLotCode('');
      setThreshold(String(target.lowStockThreshold));
      setWarehouseId('');
    }
  }, [target]);

  if (!target) return <Dialog open={false} onClose={onClose} title="" />;

  const n = Number.parseInt(qty, 10);
  const valid = Number.isInteger(n) && n >= 0 && qty.trim() !== '';
  const here = shelf?.onHand ?? target.onHand; // counts and removals are per warehouse
  const delta = !valid ? 0 : mode === 'add' ? n : mode === 'remove' ? -n : n - here;
  const after = target.onHand + delta;
  const notThere = here + delta < 0;
  const thresholdN = Number.parseInt(threshold, 10);
  const thresholdChanged = Number.isInteger(thresholdN) && thresholdN >= 0 && thresholdN !== target.lowStockThreshold;
  const tooLow = after < target.reserved;

  async function save() {
    if (!target) return;
    setBusy(true);
    try {
      await api(`/admin/variants/${target.variantId}/stock`, {
        method: 'POST',
        body: {
          delta, reason: mode === 'set' ? (delta > 0 ? 'FOUND' : 'ADJUSTMENT') : reason, note: note.trim() || undefined,
          lowStockThreshold: thresholdChanged ? thresholdN : undefined, warehouseId: shelf?.id,
          ...(mode === 'add' && reason === 'RESTOCK' && expiresOn && { expiresOn, lotCode: lotCode.trim() || undefined }),
        },
      });
      toast.success('Stock updated');
      onSaved({ onHand: after, lowStockThreshold: thresholdChanged ? thresholdN : target.lowStockThreshold });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Stock"
      description={`${target.label} · ${target.sku}`}
      size="md"
      footer={
        canAdjust ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy || tooLow || notThere || (delta === 0 && !thresholdChanged)}>
              {busy ? <Spinner /> : null} Save
            </button>
          </>
        ) : undefined
      }
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-ink-50 p-2.5"><p className="text-xs text-ink-500">In stock</p><p className="text-lg font-bold tabular">{target.onHand}</p></div>
        <div className="rounded-lg bg-ink-50 p-2.5"><p className="text-xs text-ink-500">In open orders</p><p className="text-lg font-bold tabular">{target.reserved}</p></div>
        <div className="rounded-lg bg-ink-50 p-2.5"><p className="text-xs text-ink-500">Available</p><p className="text-lg font-bold tabular">{target.onHand - target.reserved}</p></div>
      </div>

      {(shelves.data?.length ?? 0) > 1 ? (
        <table className="mt-3 w-full text-sm" data-testid="stock-by-warehouse">
          <thead><tr className="text-xs text-ink-500"><th className="py-1 text-start font-medium">Warehouse</th><th className="py-1 text-end font-medium">On the shelf</th><th className="py-1 text-end font-medium">Free</th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {shelves.data!.map((w) => (
              <tr key={w.id} className={w.isActive ? '' : 'text-ink-400'}>
                <td className="py-1.5">{w.name} <span className="text-xs text-ink-400">{w.code}{w.isDefault ? ' · default' : ''}{w.isActive ? '' : ' · closed'}</span></td>
                <td className="py-1.5 text-end tabular">{w.onHand}</td>
                <td className="py-1.5 text-end tabular">{w.free}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {canAdjust ? (
        <div className="mt-4 space-y-3">
          {open.length > 1 ? (
            <Field label="Warehouse" htmlFor="stock-warehouse">
              <select id="stock-warehouse" className="input" value={shelf?.id ?? ''} onChange={(e) => setWarehouseId(e.target.value)}>
                {open.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.onHand} there)</option>)}
              </select>
            </Field>
          ) : null}
          <div className="flex rounded-lg border border-ink-200 p-0.5" role="group" aria-label="Change type">
            {([['add', 'Add (received)'], ['remove', 'Remove (damaged, lost)'], ['set', 'Set counted number']] as const).map(([m, l]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setReason(m === 'add' ? 'RESTOCK' : 'DAMAGED'); }} className={clsx('flex-1 rounded-md px-2 py-1.5 text-xs font-medium', mode === m ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100')}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={mode === 'set' ? 'Counted quantity' : 'Quantity'} htmlFor="stock-qty" error={notThere ? `Only ${here} in ${shelf?.name ?? 'this warehouse'}` : tooLow ? `Cannot go below ${target.reserved} (already in open orders)` : null}>
              <input id="stock-qty" className="input tabular" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
            <Field label="Low-stock alert at" htmlFor="stock-threshold" hint="Warn when available stock reaches this">
              <input id="stock-threshold" className="input tabular" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          {mode !== 'set' ? (
            <Field label="Reason" htmlFor="stock-reason">
              <select id="stock-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {(mode === 'add' ? ADD_REASONS : REMOVE_REASONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          ) : null}
          {mode === 'add' && reason === 'RESTOCK' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiry date" htmlFor="stock-expiry" hint="Required for food and dated products">
                <input id="stock-expiry" type="date" className="input" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </Field>
              <Field label="Batch / lot" htmlFor="stock-lot" hint="As printed on the pack (optional)">
                <input id="stock-lot" className="input" value={lotCode} onChange={(e) => setLotCode(e.target.value)} maxLength={40} />
              </Field>
            </div>
          ) : null}
          {mode !== 'add' ? <p className="text-xs text-ink-500">Write-offs worth more than QAR 500 need a manager with stock-approval rights.</p> : null}
          <Field label="Note" htmlFor="stock-note" hint="e.g. supplier invoice number, reason for the correction">
            <input id="stock-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          {valid && delta !== 0 ? (
            <p className="text-sm text-ink-600">
              New stock: <strong className="tabular">{after}</strong> ({delta > 0 ? '+' : ''}{delta})
            </p>
          ) : null}
        </div>
      ) : null}

      <h3 className="mt-5 mb-2 text-sm font-semibold">History</h3>
      {!history.data ? (
        <div className="skeleton h-20" />
      ) : history.data.length === 0 ? (
        <p className="text-sm text-ink-500">No stock changes yet.</p>
      ) : (
        <ul className="max-h-60 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100 text-sm">
          {history.data.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium text-ink-800">{REASON_LABEL[m.reason] ?? humanize(m.reason)}{m.note ? <span className="font-normal text-ink-500"> · {m.note}</span> : null}</p>
                <p className="text-xs text-ink-500">{formatDateTime(m.createdAt)}{m.actorName ? ` · ${m.actorName}` : m.refType === 'order_item' ? ' · order' : ''}{m.warehouseId && (shelves.data?.length ?? 0) > 1 ? ` · ${shelves.data!.find((w) => w.id === m.warehouseId)?.code ?? ''}` : ''}</p>
              </div>
              <span className={clsx('shrink-0 font-semibold tabular', m.qtyDelta > 0 ? 'text-success-600' : m.qtyDelta < 0 ? 'text-danger-600' : 'text-ink-500')}>
                {m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
