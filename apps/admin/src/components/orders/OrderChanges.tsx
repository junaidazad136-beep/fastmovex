'use client';

import { CalendarClock, History, MapPin, PencilLine, Phone, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, Dialog, Spinner, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime, formatMoney, formatSlot } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

export interface OrderChangeRow { id: string; kind: 'ITEMS' | 'ADDED' | 'ADDRESS' | 'SLOT' | 'DOOR_REFUSAL'; byRole: 'STAFF' | 'CUSTOMER' | 'DRIVER'; actorName: string | null; reason: string | null; summary: string; amountMinor: string; createdAt: string }
interface Item { id: string; productTitle: string; sku: string; quantity: number; unitPriceMinor: string; status: string }
interface Shipment { id: string; status: string; items: Item[] }
export interface ChangeableOrder {
  orderNumber: string; currencyCode: string; editable?: boolean; shippingAddress: Record<string, unknown> | null;
  deliverySlotStart?: string | null; deliverySlotEnd?: string | null; sellerOrders: Shipment[];
  payments: { method: string }[];
}

const EDITABLE = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];
const KIND: Record<OrderChangeRow['kind'], string> = { ITEMS: 'Items changed', ADDED: 'Items added', ADDRESS: 'Address changed', SLOT: 'Delivery time changed', DOOR_REFUSAL: 'Refused at the door' };
const WHO: Record<OrderChangeRow['byRole'], string> = { STAFF: 'staff', CUSTOMER: 'the customer', DRIVER: 'the driver' };

/** "Taken by phone by Mona" — shown next to the order date. */
export function PlacedByBadge({ placedBy }: { placedBy?: { name: string | null } | null }) {
  if (!placedBy) return null;
  return <Badge tone="blue" className="align-middle"><Phone className="size-3" aria-hidden />Phone order{placedBy.name ? ` · ${placedBy.name}` : ''}</Badge>;
}

/** Everything changed after checkout, oldest first, with who did it and what it did to the total. */
export function OrderChangesCard({ changes, currency }: { changes?: OrderChangeRow[]; currency: string }) {
  if (!changes?.length) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><History className="size-4 text-ink-400" aria-hidden />Changes after checkout</span>}>
      <ol className="space-y-3" data-testid="order-changes">
        {changes.map((c) => (
          <li key={c.id} className="text-sm">
            <p className="font-medium text-ink-900">{KIND[c.kind]}{BigInt(c.amountMinor) > 0n
              ? c.kind === 'ADDED'
                ? <span className="font-normal text-ink-700"> · total +{formatMoney(c.amountMinor, currency)}</span>
                : <span className="font-normal text-success-700"> · total −{formatMoney(c.amountMinor, currency)}</span>
              : null}</p>
            <p className="text-ink-700">{c.summary}</p>
            {c.reason ? <p className="text-ink-500">“{c.reason}”</p> : null}
            <p className="text-xs text-ink-400">{c.actorName ?? WHO[c.byRole]} · {formatDateTime(c.createdAt)}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Buttons + dialogs to change items, address or delivery time before the shipment leaves. */
export function OrderChangeActions({ order, onChanged }: { order: ChangeableOrder; onChanged: () => void }) {
  const [open, setOpen] = useState<'items' | 'add' | 'address' | 'slot' | null>(null);
  if (!order.editable) return null;
  const cash = order.payments[0]?.method === 'COD';
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen('items')} data-testid="change-items"><PencilLine className="size-4" aria-hidden /> Change items</button>
      {cash ? <button type="button" className="btn-secondary" onClick={() => setOpen('add')} data-testid="add-item"><Plus className="size-4" aria-hidden /> Add item</button> : null}
      <button type="button" className="btn-secondary" onClick={() => setOpen('address')} data-testid="change-address"><MapPin className="size-4" aria-hidden /> Address</button>
      <button type="button" className="btn-secondary" onClick={() => setOpen('slot')} data-testid="change-slot"><CalendarClock className="size-4" aria-hidden /> Delivery time</button>
      {open === 'items' ? <ItemsDialog order={order} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} /> : null}
      {open === 'add' ? <AddItemDialog order={order} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} /> : null}
      {open === 'address' ? <AddressDialog order={order} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} /> : null}
      {open === 'slot' ? <SlotDialog order={order} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChanged(); }} /> : null}
    </>
  );
}

function ItemsDialog({ order, onClose, onDone }: { order: ChangeableOrder; onClose: () => void; onDone: () => void }) {
  const lines = order.sellerOrders.filter((s) => EDITABLE.includes(s.status)).flatMap((s) => s.items.filter((i) => i.status !== 'CANCELLED'));
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(lines.map((l) => [l.id, l.quantity])));
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const changes = lines.filter((l) => qty[l.id] !== l.quantity).map((l) => ({ itemId: l.id, quantity: qty[l.id] }));
  const less = lines.reduce((n, l) => n + BigInt(l.unitPriceMinor) * BigInt(l.quantity - qty[l.id]), 0n);
  const cash = order.payments[0]?.method === 'COD';
  async function save() {
    const r = await run('items', () => api(`/admin/orders/${encodeURIComponent(order.orderNumber)}/items`, { method: 'PATCH', body: { changes, reason: reason.trim() } }),
      cash ? 'Order changed — the cash to collect went down' : 'Order changed — a refund for the difference is waiting for approval');
    if (r !== undefined) { summaryStale(); onDone(); }
  }
  return (
    <Dialog open onClose={onClose} title="Change items" description="Reduce or remove items before the shipment leaves. The stock goes back on sale and the customer is told. To add something, use Add item (cash orders)."
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!changes.length || reason.trim().length < 5 || busy === 'items'} onClick={save} data-testid="save-items">{busy === 'items' ? <Spinner /> : null}Save changes</button></>}>
      <ul className="divide-y divide-ink-100" data-testid="items-editor">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{l.productTitle}</p><p className="text-xs text-ink-500">{l.sku} · {formatMoney(l.unitPriceMinor, order.currencyCode)} each</p></div>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-secondary btn-sm px-2" onClick={() => setQty({ ...qty, [l.id]: Math.max(0, qty[l.id] - 1) })} aria-label={`One fewer ${l.productTitle}`} disabled={qty[l.id] === 0}>−</button>
              <span className={`w-10 text-center text-sm font-semibold tabular ${qty[l.id] === 0 ? 'text-danger-600' : ''}`} data-testid="item-qty">{qty[l.id]}</span>
              <button type="button" className="btn-secondary btn-sm px-2" onClick={() => setQty({ ...qty, [l.id]: Math.min(l.quantity, qty[l.id] + 1) })} aria-label={`One more ${l.productTitle}`} disabled={qty[l.id] === l.quantity}>+</button>
            </div>
          </li>
        ))}
      </ul>
      {changes.length ? <p className="mt-2 text-sm text-ink-700">About {formatMoney(less.toString(), order.currencyCode)} less{cash ? ' to collect in cash' : ', refunded after approval'} (exact amount after discounts and VAT).</p> : null}
      <TextArea label="Why? (the customer sees the change, this reason stays internal)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} placeholder="e.g. Customer called: only one box" className="mt-3" />
    </Dialog>
  );
}

interface Addable { variantId: string; sku: string; title: string; store: string; priceMinor: string; currencyCode: string; available: number }

/** The customer wants one more thing before the shipment leaves (cash orders): today's price, stock reserved, more cash to collect. */
function AddItemDialog({ order, onClose, onDone }: { order: ChangeableOrder; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Addable[] | null>(null);
  const [pick, setPick] = useState<Addable | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    const r = await run('find', () => api<Addable[]>(`/admin/orders/${encodeURIComponent(order.orderNumber)}/addable-products?q=${encodeURIComponent(q.trim())}`));
    if (r) setFound(r);
  }
  async function save() {
    if (!pick) return;
    const r = await run('add', () => api(`/admin/orders/${encodeURIComponent(order.orderNumber)}/items`, { method: 'POST', body: { variantId: pick.variantId, quantity: qty, reason: reason.trim() } }), 'Item added — the cash to collect went up and the customer was told');
    if (r !== undefined) { summaryStale(); onDone(); }
  }
  return (
    <Dialog open onClose={onClose} title="Add item" description="Same seller as a shipment that has not left yet. Today's price (a live deal counts); the stock is reserved at once."
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!pick || reason.trim().length < 5 || busy === 'add'} onClick={save} data-testid="save-add-item">{busy === 'add' ? <Spinner /> : null}Add to order</button></>}>
      <form onSubmit={search} className="flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name, SKU or barcode" aria-label="Find product to add" />
        <button type="submit" className="btn-secondary" disabled={busy === 'find'}>{busy === 'find' ? <Spinner /> : <Search className="size-4" aria-hidden />}Find</button>
      </form>
      {found ? (
        <ul className="mt-3 max-h-56 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100" data-testid="addable-results">
          {found.map((p) => (
            <li key={p.variantId}>
              <button type="button" className={`flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-ink-50 ${pick?.variantId === p.variantId ? 'bg-brand-50' : ''}`} disabled={p.available < 1} onClick={() => { setPick(p); setQty(1); }} aria-pressed={pick?.variantId === p.variantId}>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.title}</span><span className="block text-xs text-ink-500">{p.sku} · {p.store} · {p.available} free</span></span>
                <span className="text-sm tabular">{formatMoney(p.priceMinor, p.currencyCode)}</span>
              </button>
            </li>
          ))}
          {found.length === 0 ? <li className="px-3 py-3 text-sm text-ink-500">Nothing found from the sellers on this order.</li> : null}
        </ul>
      ) : null}
      {pick ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-ink-50 px-3 py-2" data-testid="add-item-pick">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{pick.title}</span>
          <button type="button" className="btn-secondary btn-sm px-2" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="One fewer">−</button>
          <span className="w-8 text-center text-sm font-semibold tabular" data-testid="add-item-qty">{qty}</span>
          <button type="button" className="btn-secondary btn-sm px-2" onClick={() => setQty(Math.min(pick.available, 99, qty + 1))} aria-label="One more">+</button>
          <span className="text-sm tabular">≈ {formatMoney((BigInt(pick.priceMinor) * BigInt(qty)).toString(), pick.currencyCode)}</span>
        </div>
      ) : null}
      <TextArea label="Why? (internal; the customer sees what was added)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} placeholder="e.g. Customer called: add a second charger" className="mt-3" />
    </Dialog>
  );
}

const FIELDS: [string, string][] = [['recipientName', 'Recipient'], ['phone', 'Phone'], ['city', 'City'], ['zone', 'Zone'], ['street', 'Street'], ['building', 'Building'], ['unit', 'Unit / flat']];

function AddressDialog({ order, onClose, onDone }: { order: ChangeableOrder; onClose: () => void; onDone: () => void }) {
  const a = order.shippingAddress ?? {};
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([k]) => [k, typeof a[k] === 'string' ? (a[k] as string) : ''])));
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  async function save() {
    const address = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    const r = await run('addr', () => api(`/admin/orders/${encodeURIComponent(order.orderNumber)}/address`, { method: 'PUT', body: { address, reason: reason.trim() || undefined } }), 'Address changed — the driver sees the new one');
    if (r !== undefined) onDone();
  }
  return (
    <Dialog open onClose={onClose} title="Change delivery address" footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'addr'} onClick={save} data-testid="save-address">{busy === 'addr' ? <Spinner /> : null}Save address</button></>}>
      <div className="grid gap-3 sm:grid-cols-2" data-testid="address-editor">
        {FIELDS.map(([k, label]) => <TextField key={k} label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={['recipientName', 'phone', 'city'].includes(k)} />)}
      </div>
      <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-3" />
    </Dialog>
  );
}

interface Slots { enabled: boolean; required: boolean; days: { date: string; slots: { start: string; end: string; left: number; available: boolean }[] }[] }

function SlotDialog({ order, onClose, onDone }: { order: ChangeableOrder; onClose: () => void; onDone: () => void }) {
  const slots = useApi<Slots>('/delivery/slots');
  const [pick, setPick] = useState<string>('');
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  useEffect(() => setPick(''), [slots.data]);
  async function save() {
    const r = await run('slot', () => api(`/admin/orders/${encodeURIComponent(order.orderNumber)}/slot`, { method: 'PUT', body: { deliverySlot: pick || null, reason: reason.trim() || undefined } }), 'Delivery time changed');
    if (r !== undefined) onDone();
  }
  const windows = slots.data?.days.flatMap((d) => d.slots.map((w) => ({ ...w, day: d.date }))) ?? [];
  return (
    <Dialog open onClose={onClose} title="Change delivery time" description={order.deliverySlotStart ? `Now: ${formatSlot(order.deliverySlotStart, order.deliverySlotEnd)}` : 'Now: any time'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'slot' || (!pick && !!slots.data?.required)} onClick={save} data-testid="save-slot">{busy === 'slot' ? <Spinner /> : null}Save</button></>}>
      {slots.data && !slots.data.enabled ? <p className="text-sm text-ink-600">Delivery windows are switched off for this market (Settings → Delivery times).</p> : null}
      {windows.length ? (
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="New delivery window" data-testid="slot-select">
          <option value="">{slots.data?.required ? 'Choose a window…' : 'Any time'}</option>
          {windows.map((w) => <option key={w.start} value={w.start} disabled={!w.available}>{formatSlot(w.start, w.end)}{!w.available ? ' (full)' : ` · ${w.left} left`}</option>)}
        </select>
      ) : null}
      <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-3" />
    </Dialog>
  );
}
