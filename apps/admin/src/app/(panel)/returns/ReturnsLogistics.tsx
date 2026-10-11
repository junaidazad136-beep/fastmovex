'use client';

import { Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Dialog, EmptyState, ErrorState, SkeletonRows, Spinner, Table, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDate, formatDateTime, todayInQatar } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

export interface Pickup { status: 'ASSIGNED' | 'COLLECTED' | 'FAILED' | 'CANCELLED'; date: string; driver: string | null; collectedAt: string | null; failureReason: string | null }

/** Pickup status under a return: who collects it and when, collected, or why it failed. */
export function PickupBadge({ p }: { p?: Pickup | null }) {
  if (!p || p.status === 'CANCELLED') return null;
  if (p.status === 'COLLECTED') return <p className="mt-1 text-xs" data-testid="pickup-status"><Badge tone="green"><Truck className="size-3" aria-hidden />Collected by {p.driver ?? 'driver'}</Badge></p>;
  if (p.status === 'FAILED') return <p className="mt-1 text-xs" data-testid="pickup-status"><Badge tone="red">Pickup failed</Badge> <span className="text-ink-500">{p.failureReason}</span></p>;
  return <p className="mt-1 text-xs" data-testid="pickup-status"><Badge tone="blue"><Truck className="size-3" aria-hidden />{p.driver ?? 'Driver'} · {formatDate(p.date)}</Badge></p>;
}

/** Arrange (or re-arrange) a driver to collect an approved return. */
export function PickupDialog({ returnId, item, onClose, onDone }: { returnId: string; item: string; onClose: () => void; onDone: () => void }) {
  const couriers = useApi<{ id: string; fullName: string }[]>('/admin/deliveries/couriers');
  const [driver, setDriver] = useState('');
  const [date, setDate] = useState(todayInQatar());
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  async function save() {
    const r = await run('pickup', () => api(`/admin/returns/${returnId}/pickup`, { method: 'POST', body: { courierUserId: driver, date, note: note.trim() || undefined } }), 'Pickup arranged — the customer has been told');
    if (r !== undefined) onDone();
  }
  return (
    <Dialog open onClose={onClose} title="Arrange pickup" description={`A driver collects ${item} from the customer. It shows on the driver's page that day.`} size="sm"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!driver || !date || busy === 'pickup'} onClick={save} data-testid="pickup-save">{busy === 'pickup' ? <Spinner /> : null}Arrange</button></>}>
      <div className="space-y-3" data-testid="pickup-form">
        <label className="block text-sm font-medium">Driver
          <select className="input mt-1" value={driver} onChange={(e) => setDriver(e.target.value)} aria-label="Driver">
            <option value="">Choose a driver…</option>
            {couriers.data?.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </select>
        </label>
        <TextField label="Day" type="date" value={date} min={todayInQatar()} onChange={(e) => setDate(e.target.value)} />
        <TextArea label="Note for the driver (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
      </div>
    </Dialog>
  );
}

interface DoorReturn { id: string; quantity: number; reason: string; createdAt: string; receivedAt: string | null; condition: string | null; note: string | null; driver: string | null; receivedBy: string | null; orderItem: { productTitle: string; sku: string; order: { orderNumber: string } } }

/** Items customers refused at the door: on the driver's van until the warehouse books them back in. */
export function DoorReturns() {
  const [open, setOpen] = useState(true);
  const list = useApi<DoorReturn[]>(`/admin/door-returns?open=${open}`);
  const [booking, setBooking] = useState<DoorReturn | null>(null);
  const [condition, setCondition] = useState<'SELLABLE' | 'DAMAGED'>('SELLABLE');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  async function receive() {
    if (!booking) return;
    const r = await run('door', () => api(`/admin/door-returns/${booking.id}/receive`, { method: 'POST', body: { condition, note: note.trim() || undefined } }), condition === 'SELLABLE' ? 'Back on the shelf' : 'Recorded as damaged, kept off stock');
    if (r !== undefined) { setBooking(null); list.reload(); summaryStale(); }
  }
  return (
    <div data-testid="door-returns">
      <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 text-sm">
        <button type="button" className={open ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setOpen(true)}>With the driver</button>
        <button type="button" className={!open ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setOpen(false)}>Booked in</button>
        <p className="ms-2 text-xs text-ink-500">The customer took the rest of the order; these units ride back and are booked in here.</p>
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <Table>
        <thead><tr><th className="th">Item</th><th className="th">Why</th><th className="th">Driver</th><th className="th">{open ? 'Refused' : 'Booked in'}</th><th className="th text-end" /></tr></thead>
        <tbody>
          {!list.data && !list.error ? <SkeletonRows cols={5} /> : null}
          {list.data?.map((d) => (
            <tr key={d.id} data-testid="door-return-row">
              <td className="td"><p className="font-medium">{d.quantity} × {d.orderItem.productTitle}</p><p className="text-xs text-ink-500">{d.orderItem.sku} · <Link href={`/orders/${d.orderItem.order.orderNumber}`} className="link">{d.orderItem.order.orderNumber}</Link></p></td>
              <td className="td text-sm text-ink-700">{d.reason}{d.note ? <p className="text-xs text-ink-500">{d.note}</p> : null}</td>
              <td className="td text-sm">{d.driver ?? '—'}</td>
              <td className="td text-sm">{open ? formatDateTime(d.createdAt) : <>{formatDateTime(d.receivedAt)}<p className="text-xs"><Badge tone={d.condition === 'SELLABLE' ? 'green' : 'amber'}>{d.condition === 'SELLABLE' ? 'Back on shelf' : 'Damaged'}</Badge> {d.receivedBy}</p></>}</td>
              <td className="td text-end">{open ? <button type="button" className="btn-primary btn-sm" onClick={() => { setBooking(d); setCondition('SELLABLE'); setNote(''); }} data-testid="door-receive">Book in</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {list.data?.length === 0 ? <EmptyState title={open ? 'Nothing on the way back' : 'Nothing booked in yet'} /> : null}
      <Dialog open={!!booking} onClose={() => setBooking(null)} title="Book back in" description={booking ? `${booking.quantity} × ${booking.orderItem.productTitle}` : undefined} size="sm"
        footer={<><button type="button" className="btn-ghost" onClick={() => setBooking(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'door' || (condition === 'DAMAGED' && note.trim().length < 5)} onClick={receive} data-testid="door-receive-confirm">{busy === 'door' ? <Spinner /> : null}Save</button></>}>
        <fieldset className="space-y-2">
          {(['SELLABLE', 'DAMAGED'] as const).map((c) => (
            <label key={c} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${condition === c ? 'border-brand-600 bg-brand-50/50' : 'border-ink-200'}`}>
              <input type="radio" name="door-condition" checked={condition === c} onChange={() => setCondition(c)} className="mt-0.5 accent-brand-600" />
              <span className="text-sm"><span className="block font-medium">{c === 'SELLABLE' ? 'As new' : 'Damaged'}</span><span className="block text-ink-500">{c === 'SELLABLE' ? 'Back on the shelf it left from.' : 'Kept off sellable stock, recorded.'}</span></span>
            </label>
          ))}
        </fieldset>
        {condition === 'DAMAGED' ? <TextArea className="mt-3" label="What is wrong? (required)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} /> : null}
      </Dialog>
    </div>
  );
}
