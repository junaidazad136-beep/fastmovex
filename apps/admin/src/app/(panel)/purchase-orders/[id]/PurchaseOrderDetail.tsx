'use client';

import { Ban, FileText, PackageCheck, Pencil, Send } from 'lucide-react';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, ConfirmDialog, Dialog, ErrorState, KeyValue, Loading, PageHeader, Spinner, Table, TextField } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { formatDate, formatDateTime, formatMoney, minorToInput, todayInQatar } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';
import { linesPayload, PO_STATUS, PoLinesEditor, type DraftLine } from '../PurchaseOrdersPage';

interface Line {
  id: string; variantId: string; sku: string; barcode: string | null; title: string; tracksExpiry: boolean;
  quantity: number; receivedQty: number; remaining: number; unitCostMinor: string; lineTotalMinor: string;
}
interface Receipt { id: string; number: string; supplierRef: string | null; note: string | null; createdAt: string; receivedBy: { fullName: string | null }; lines: { poLineId: string; quantity: number; lotCode: string | null; expiresOn: string | null }[] }
interface Po {
  id: string; number: string; status: string; currencyCode: string; totalMinor: string; expectedOn: string | null; note: string | null; createdAt: string; orderedAt: string | null; receivedAt: string | null;
  supplier: { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; paymentTerms: string | null };
  warehouse: { id: string; name: string; code: string };
  createdBy: { id: string; fullName: string | null }; orderedBy: { id: string; fullName: string | null } | null;
  lines: Line[]; receipts: Receipt[];
}

export function PurchaseOrderDetail({ id }: { id: string }) {
  const { can, user } = useSession();
  const po = useApi<Po>(`/admin/purchase-orders/${id}`);
  const [confirm, setConfirm] = useState<'order' | 'cancel' | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState<DraftLine[] | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const p = po.data;
  if (po.error) return <ErrorState error={po.error} onRetry={po.reload} />;
  if (!p) return <Loading />;

  const openForReceipt = p.status === 'ORDERED' || p.status === 'PARTIAL';
  const ownOrder = p.createdBy.id === user?.id && !user?.roles.includes('SUPER_ADMIN');
  const lotsOf = (lineId: string) => p.receipts.flatMap((r) => r.lines.filter((l) => l.poLineId === lineId && (l.lotCode || l.expiresOn)));

  async function act(kind: 'order' | 'cancel') {
    const r = await run(kind, () => api<Po>(`/admin/purchase-orders/${id}/${kind}`, { method: 'POST' }), kind === 'order' ? 'Marked as sent to the supplier' : 'Purchase order cancelled');
    setConfirm(null);
    if (r) { po.setData(r); summaryStale(); }
  }

  async function saveLines() {
    if (!editing) return;
    const body = linesPayload(editing);
    if ('error' in body) return toast.error(body.error);
    const r = await run('edit', () => api<Po>(`/admin/purchase-orders/${id}`, { method: 'PATCH', body }), 'Draft updated');
    if (r) { po.setData(r); setEditing(null); }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/purchase-orders', label: 'Purchase orders' }}
        title={<span className="font-mono">{p.number}</span>}
        description={<>{p.supplier.name} → {p.warehouse.name}{p.expectedOn ? ` · expected ${formatDate(p.expectedOn)}` : ''}</>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PO_STATUS[p.status]?.tone ?? 'gray'}>{PO_STATUS[p.status]?.label ?? p.status}</Badge>
            <button type="button" className="btn-secondary" disabled={busy === 'pdf'} onClick={() => run('pdf', () => openPdf(`/admin/purchase-orders/${id}/pdf`, `${p.number}.pdf`))}><FileText className="size-4" aria-hidden /> PDF</button>
            {p.status === 'DRAFT' && can('purchasing.manage') ? (
              <>
                <button type="button" className="btn-secondary" onClick={() => setEditing(p.lines.map((l) => ({ variantId: l.variantId, sku: l.sku, title: l.title, quantity: String(l.quantity), cost: minorToInput(l.unitCostMinor) })))}><Pencil className="size-4" aria-hidden /> Edit</button>
                <button type="button" className="btn-primary" onClick={() => setConfirm('order')} data-testid="po-order"><Send className="size-4" aria-hidden /> Mark as sent</button>
              </>
            ) : null}
            {openForReceipt && can('purchasing.receive') ? (
              ownOrder ? <span className="text-sm text-ink-500" data-testid="own-po">You raised this order — someone else receives the goods</span>
                : <button type="button" className="btn-primary" onClick={() => setReceiving(true)} data-testid="po-receive"><PackageCheck className="size-4" aria-hidden /> Receive goods</button>
            ) : null}
            {['DRAFT', 'ORDERED', 'PARTIAL'].includes(p.status) && can('purchasing.manage') ? <button type="button" className="btn-ghost" onClick={() => setConfirm('cancel')}><Ban className="size-4" aria-hidden /> Cancel</button> : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Products" bodyClassName="p-0">
          <Table>
            <thead><tr><th className="th">Product</th><th className="th text-end">Ordered</th><th className="th text-end">Received</th><th className="th text-end">Unit cost</th><th className="th text-end">Total</th></tr></thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id} data-testid="po-detail-line">
                  <td className="td">
                    <p className="font-medium">{l.title} {l.tracksExpiry ? <Badge tone="amber">Dated</Badge> : null}</p>
                    <p className="text-xs text-ink-500">{l.sku}{l.barcode ? ` · ${l.barcode}` : ''}</p>
                    {lotsOf(l.id).map((x, i) => <p key={i} className="text-xs text-ink-500">Batch {x.lotCode ?? '—'}{x.expiresOn ? ` · expires ${formatDate(x.expiresOn)}` : ''} · {x.quantity}</p>)}
                  </td>
                  <td className="td text-end tabular">{l.quantity}</td>
                  <td className={`td text-end tabular ${l.receivedQty === l.quantity ? 'text-success-600' : l.receivedQty ? 'text-amber-700' : ''}`}>{l.receivedQty}</td>
                  <td className="td text-end tabular">{formatMoney(l.unitCostMinor, p.currencyCode)}</td>
                  <td className="td text-end tabular">{formatMoney(l.lineTotalMinor, p.currencyCode)}</td>
                </tr>
              ))}
              <tr><td className="td font-semibold" colSpan={4}>Total</td><td className="td text-end font-semibold tabular">{formatMoney(p.totalMinor, p.currencyCode)}</td></tr>
            </tbody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Order">
            <KeyValue items={[
              ['Supplier', <>{p.supplier.name}{p.supplier.phone ? <span className="block text-xs text-ink-500" dir="ltr">{p.supplier.phone}</span> : null}</>],
              ['Payment terms', p.supplier.paymentTerms ?? '—'],
              ['Raised by', `${p.createdBy.fullName ?? '—'} · ${formatDateTime(p.createdAt)}`],
              ['Sent', p.orderedAt ? `${p.orderedBy?.fullName ?? ''} · ${formatDateTime(p.orderedAt)}` : 'Not yet'],
              ...(p.note ? [['Note', p.note] as [string, string]] : []),
            ]} />
          </Card>
          <Card title="Goods receipts" bodyClassName={p.receipts.length ? 'p-0' : undefined}>
            {p.receipts.length ? (
              <ul className="divide-y divide-ink-100">
                {p.receipts.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm" data-testid="grn">
                    <p className="font-mono font-semibold">{r.number}</p>
                    <p className="text-xs text-ink-500">{formatDateTime(r.createdAt)} · {r.receivedBy.fullName} · {r.lines.reduce((n, l) => n + l.quantity, 0)} units{r.supplierRef ? ` · delivery note ${r.supplierRef}` : ''}</p>
                    {r.note ? <p className="mt-1 text-xs">{r.note}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-500">Nothing received yet.</p>}
          </Card>
        </div>
      </div>

      {receiving ? <ReceiveDialog po={p} onClose={() => setReceiving(false)} onDone={(next) => { setReceiving(false); po.setData(next); summaryStale(); }} /> : null}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit draft" size="xl"
        footer={<><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn-primary" disabled={busy === 'edit'} onClick={saveLines}>{busy === 'edit' ? <Spinner /> : null} Save</button></>}>
        {editing ? <PoLinesEditor lines={editing} onChange={setEditing} currency={p.currencyCode} /> : null}
      </Dialog>

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} busy={!!busy} danger={confirm === 'cancel'}
        onConfirm={() => confirm && act(confirm)}
        confirmLabel={confirm === 'order' ? 'Mark as sent' : 'Cancel order'}
        title={confirm === 'order' ? 'Send this order to the supplier?' : 'Cancel this purchase order?'}
        description={confirm === 'order' ? 'Send them the PDF. After this the order cannot be changed — goods are received against it.' : p.receipts.length ? 'What has not arrived yet is cancelled. Goods already received stay in stock.' : 'Nothing has been received; the order is closed.'} />
    </>
  );
}

function ReceiveDialog({ po, onClose, onDone }: { po: Po; onClose: () => void; onDone: (next: Po) => void }) {
  const open = po.lines.filter((l) => l.remaining > 0);
  const [rows, setRows] = useState<Record<string, { qty: string; lot: string; expires: string }>>(() => Object.fromEntries(open.map((l) => [l.id, { qty: String(l.remaining), lot: '', expires: '' }])));
  const [supplierRef, setSupplierRef] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const set = (id: string, patch: Partial<{ qty: string; lot: string; expires: string }>) => setRows({ ...rows, [id]: { ...rows[id], ...patch } });

  const problems = open.flatMap((l) => {
    const r = rows[l.id];
    const q = Number.parseInt(r.qty || '0', 10);
    if (q > l.remaining) return [`${l.sku}: only ${l.remaining} expected`];
    if (q > 0 && l.tracksExpiry && !r.expires) return [`${l.sku}: enter the expiry date`];
    if (q > 0 && r.expires && r.expires < todayInQatar()) return [`${l.sku}: this date has already passed`];
    return [];
  });
  const lines = open.map((l) => ({ l, r: rows[l.id] })).filter(({ r }) => Number.parseInt(r.qty || '0', 10) > 0);

  async function submit() {
    const res = await run('receive', () => api<{ receipt: { number: string; units: number }; order: Po }>(`/admin/purchase-orders/${po.id}/receive`, {
      method: 'POST',
      body: {
        supplierRef: supplierRef.trim() || undefined, note: note.trim() || undefined,
        lines: lines.map(({ l, r }) => ({ lineId: l.id, quantity: Number.parseInt(r.qty, 10), lotCode: r.lot.trim() || undefined, expiresOn: r.expires || undefined })),
      },
    }), (x) => `${x.receipt.number}: ${x.receipt.units} units added to ${po.warehouse.name}`);
    if (res) onDone(res.order);
  }

  return (
    <Dialog open onClose={onClose} title="Receive goods" description={`Count what arrived. Units go on the shelf at ${po.warehouse.name}; the receipt cannot be changed later.`} size="xl"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={!!busy || !!problems.length || !lines.length} onClick={submit} data-testid="grn-submit">{busy ? <Spinner /> : null} Receive {lines.reduce((n, { r }) => n + Number.parseInt(r.qty, 10), 0)} units</button></>}>
      <div className="space-y-4" data-testid="grn-dialog">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-ink-500"><th className="py-1 text-start font-medium">Product</th><th className="w-20 py-1 text-end font-medium">Arrived</th><th className="w-32 py-1 ps-2 text-start font-medium">Batch</th><th className="w-40 py-1 ps-2 text-start font-medium">Expiry</th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {open.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pe-2"><p className="font-medium">{l.title}</p><p className="text-xs text-ink-500">{l.sku} · {l.remaining} expected</p></td>
                <td className="py-2"><input className="input text-end tabular" inputMode="numeric" value={rows[l.id].qty} onChange={(e) => set(l.id, { qty: e.target.value.replace(/\D/g, '') })} aria-label={`Arrived ${l.sku}`} /></td>
                <td className="py-2 ps-2"><input className="input" value={rows[l.id].lot} onChange={(e) => set(l.id, { lot: e.target.value })} maxLength={40} aria-label={`Batch ${l.sku}`} /></td>
                <td className="py-2 ps-2"><input type="date" className="input" value={rows[l.id].expires} onChange={(e) => set(l.id, { expires: e.target.value })} aria-label={`Expiry ${l.sku}`} aria-required={l.tracksExpiry} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {problems.length ? <p className="text-sm text-danger-600" role="alert">{problems[0]}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Supplier delivery note / invoice no." value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} maxLength={60} />
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. 2 cartons dented, accepted" />
        </div>
      </div>
    </Dialog>
  );
}
