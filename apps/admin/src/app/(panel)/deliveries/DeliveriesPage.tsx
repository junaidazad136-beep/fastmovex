'use client';

import { Camera, MapPinOff, MessageSquare, Printer, Truck } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Spinner, StatusBadge, Table, Tabs } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { formatDateTime, formatSlot } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';
import { DriverPerformance } from './DriverPerformance';

// Leaflet needs the browser
const LiveMap = dynamic(() => import('./LiveMap').then((m) => m.LiveMap), { ssr: false });

interface Delivery {
  id: string;
  status: string;
  method: 'JOVIA' | 'SELLER' | string;
  courierUserId: string | null;
  courierName: string | null;
  attempts: number;
  failureReason: string | null;
  failedAt?: string | null;
  failureDistanceM?: number | null;
  failureLat?: number | null;
  failurePhotoKey?: string | null;
  customerRequest?: string | null;
  customerRequestAt?: string | null;
  deliveredAt: string | null;
  proofOfDeliveryKey: string | null;
  createdAt: string;
  sellerOrder: {
    id: string;
    order: { orderNumber: string; shippingAddress: Record<string, string | null>; deliverySlotStart: string | null; deliverySlotEnd: string | null };
    warehouse: { name: string; code: string } | null;
    seller: { store: { name: string } | null };
  };
}
interface Courier { id: string; fullName: string; phone: string | null }

const VIEWS = {
  assign: { label: 'To assign', query: { unassigned: true } },
  road: { label: 'On the road', query: {} },
  problems: { label: 'Not delivered', query: { status: 'FAILED' } },
  done: { label: 'Delivered', query: { status: 'DELIVERED' } },
} as const;
type View = keyof typeof VIEWS;
const PANELS = { map: 'Live map', drivers: 'Drivers' } as const;
type Panel = keyof typeof PANELS;

/** FastMoveX's own deliveries: give each job to a driver, follow it, see what went wrong and the proof photo. */
export function DeliveriesPage() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ view: 'assign' });
  const panel = (f.view in PANELS ? f.view : null) as Panel | null;
  const view = (f.view in VIEWS ? f.view : 'assign') as View;
  const list = useApi<Delivery[]>(ready && !panel ? `/admin/deliveries${qs(VIEWS[view].query)}` : null);
  const couriers = useApi<Courier[]>('/admin/deliveries/couriers');
  const [pick, setPick] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const canAssign = can('delivery.manage');
  const [sheetFor, setSheetFor] = useState('');
  async function printSheet() {
    if (!sheetFor) return;
    await run('sheet', () => openPdf(`/admin/deliveries/run-sheet.pdf${qs({ courierUserId: sheetFor })}`, 'run-sheet.pdf'));
  }

  async function assign(d: Delivery) {
    const courierUserId = pick[d.id] ?? d.courierUserId ?? '';
    if (!courierUserId) return;
    const ok = await run(d.id, () => api(`/admin/deliveries/${d.id}/assign`, { method: 'POST', body: { courierUserId } }), 'Driver assigned — it is on their phone now');
    if (ok !== undefined) list.reload();
  }
  async function failurePhoto(d: Delivery) {
    const r = await run(`${d.id}-fphoto`, () => api<{ url: string }>(`/admin/deliveries/${d.id}/failure-photo`));
    if (r) window.open(r.url, '_blank', 'noopener,noreferrer');
  }
  async function proof(d: Delivery) {
    const r = await run(`${d.id}-proof`, () => api<{ url: string }>(`/admin/deliveries/${d.id}/proof`));
    if (r) window.open(r.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      <PageHeader
        title="Deliveries"
        description={<>Shipments marked <em>Ready for pickup</em> wait here for a FastMoveX driver. Drivers see their jobs on the <Link href="/driver" className="link">driver page</Link> on their phone, in delivery-window order.</>}
        actions={
          <div className="flex items-center gap-2" data-testid="run-sheet">
            <select className="input py-1.5" value={sheetFor} onChange={(e) => setSheetFor(e.target.value)} aria-label="Driver for the run sheet">
              <option value="">Choose a driver…</option>
              {couriers.data?.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </select>
            <button type="button" className="btn-secondary" disabled={!sheetFor || busy === 'sheet'} onClick={printSheet}>
              {busy === 'sheet' ? <Spinner /> : <Printer className="size-4" aria-hidden />} Run sheet
            </button>
          </div>
        }
      />
      <Card bodyClassName="p-0">
        <Tabs<string>
          value={panel ?? view}
          onChange={(v) => setF({ view: v })}
          tabs={[...(Object.keys(VIEWS) as View[]).map((v) => ({ value: v as string, label: VIEWS[v].label })), ...(Object.keys(PANELS) as Panel[]).map((v) => ({ value: v as string, label: PANELS[v] }))]}
        />
        {panel === 'map' ? <LiveMap /> : panel === 'drivers' ? <DriverPerformance /> : <>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        <Table>
          <thead>
            <tr><th className="th">Order</th><th className="th">Deliver to</th><th className="th">Window</th><th className="th">From</th><th className="th">Status</th><th className="th">Driver</th></tr>
          </thead>
          <tbody>
            {!list.data && !list.error ? <SkeletonRows cols={6} /> : null}
            {list.data?.map((d) => {
              const a = d.sellerOrder.order.shippingAddress ?? {};
              const fleet = d.method === 'JOVIA';
              return (
                <tr key={d.id} data-testid="delivery-row">
                  <td className="td"><Link href={`/orders/${d.sellerOrder.order.orderNumber}`} className="font-mono text-sm font-semibold hover:text-brand-700">{d.sellerOrder.order.orderNumber}</Link><p className="text-xs text-ink-500">{formatDateTime(d.createdAt)}</p></td>
                  <td className="td text-sm">{a.recipientName ?? '—'}<p className="text-xs text-ink-500">{[a.zone && `Zone ${a.zone}`, a.city].filter(Boolean).join(' · ')}</p></td>
                  <td className="td text-sm whitespace-nowrap">{formatSlot(d.sellerOrder.order.deliverySlotStart, d.sellerOrder.order.deliverySlotEnd) || <span className="text-ink-400">Any time</span>}</td>
                  <td className="td text-sm">{d.sellerOrder.warehouse?.name ?? d.sellerOrder.seller.store?.name ?? '—'}</td>
                  <td className="td">
                    <StatusBadge status={d.status} />
                    {d.attempts ? <p className="mt-1 text-xs text-danger-600">{d.attempts} wrong code{d.attempts > 1 ? 's' : ''}</p> : null}
                    {d.failureReason ? <p className="mt-1 max-w-[240px] text-xs text-danger-600">{d.failureReason}{d.failedAt ? ` · ${formatDateTime(d.failedAt)}` : ''}</p> : null}
                    {d.status === 'FAILED' ? <FailureProof d={d} onPhoto={() => failurePhoto(d)} busy={!!busy} /> : null}
                    {d.customerRequest ? (
                      <p className="mt-1 flex max-w-[240px] items-start gap-1 text-xs font-medium text-brand-700" data-testid="customer-request">
                        <MessageSquare className="mt-px size-3.5 shrink-0" aria-hidden /> {d.customerRequest}
                      </p>
                    ) : null}
                  </td>
                  <td className="td">
                    {!fleet ? <Badge tone="gray">Seller delivers</Badge> : canAssign && ['CREATED', 'ASSIGNED', 'FAILED'].includes(d.status) ? (
                      <div className="flex items-center gap-2">
                        <select className="input w-auto py-1.5" value={pick[d.id] ?? d.courierUserId ?? ''} onChange={(e) => setPick({ ...pick, [d.id]: e.target.value })} aria-label={`Driver for ${d.sellerOrder.order.orderNumber}`}>
                          <option value="">Choose driver…</option>
                          {couriers.data?.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                        </select>
                        <button type="button" className="btn-primary btn-sm" disabled={!!busy || !(pick[d.id] ?? d.courierUserId)} onClick={() => assign(d)} data-testid="assign-driver">
                          {busy === d.id ? <Spinner /> : <Truck className="size-4" aria-hidden />}{d.status === 'FAILED' ? 'Send again' : d.courierUserId ? 'Reassign' : 'Assign'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm">{d.courierName ?? '—'}{d.proofOfDeliveryKey ? <button type="button" className="btn-ghost btn-sm ms-2" onClick={() => proof(d)} disabled={!!busy}><Camera className="size-4" aria-hidden />Photo</button> : null}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {list.data?.length === 0 ? <EmptyState title={view === 'assign' ? 'Nothing waiting for a driver' : 'Nothing here'} description={view === 'assign' ? 'Mark a shipment “Ready for pickup” on its order page to send it with a FastMoveX driver.' : undefined} /> : null}
        {couriers.data?.length === 0 ? <p className="border-t border-ink-100 px-5 py-3 text-sm text-warning-600">No drivers yet. Add a staff account with the Delivery Agent role (Staff → Invite).</p> : null}
        </>}
      </Card>
    </>
  );
}

/** Proof of a failed attempt: how far from the customer's pin the driver was, and the door photo. Far = check before paying the driver for it. */
function FailureProof({ d, onPhoto, busy }: { d: Delivery; onPhoto: () => void; busy: boolean }) {
  const m = d.failureDistanceM;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="failure-proof">
      {m === null || m === undefined
        ? d.failureLat != null
          ? <Badge tone="gray">Location saved · address has no map pin</Badge>
          : <Badge tone="amber"><MapPinOff className="me-1 inline size-3" aria-hidden />No driver location</Badge>
        : m > 500
          ? <Badge tone="red">{m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`} from address — check</Badge>
          : <Badge tone="green">At the address ({m} m)</Badge>}
      {d.failurePhotoKey ? <button type="button" className="btn-ghost btn-sm" onClick={onPhoto} disabled={busy}><Camera className="size-4" aria-hidden />Door photo</button> : null}
    </div>
  );
}
