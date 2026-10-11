'use client';

import { AlertTriangle, Warehouse } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useAction, useApi } from '@/lib/use-api';

interface Option { id: string; code: string; name: string; hasEverything: boolean; short: { sku: string; need: number; free: number }[] }
interface Info { warehouseId: string | null; shipped: boolean; options: Option[] }

/** Which warehouse packs this shipment; staff can switch while it has not left. Warns when that one is short. */
export function ShipmentWarehouse({ shipmentId, canChange }: { shipmentId: string; canChange: boolean }) {
  const info = useApi<Info>(`/admin/orders/shipments/${shipmentId}/warehouse`);
  const { busy, run } = useAction();
  const d = info.data;
  if (!d || d.options.length <= 1) return null; // one warehouse: nothing to choose
  const current = d.options.find((o) => o.id === d.warehouseId);

  async function change(warehouseId: string) {
    const next = await run('wh', () => api<Info>(`/admin/orders/shipments/${shipmentId}/warehouse`, { method: 'POST', body: { warehouseId } }), 'Warehouse changed');
    if (next) info.setData(next);
  }

  return (
    <div className="border-t border-ink-100 px-5 py-3 text-sm" data-testid="shipment-warehouse">
      <div className="flex flex-wrap items-center gap-2">
        <Warehouse className="size-4 text-ink-400" aria-hidden />
        <span className="text-ink-600">Ships from</span>
        {canChange && !d.shipped ? (
          <select className="input w-auto py-1.5" value={d.warehouseId ?? ''} onChange={(e) => change(e.target.value)} disabled={busy === 'wh'} aria-label="Ships from warehouse">
            {d.options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.hasEverything ? '' : ' — short'}</option>)}
          </select>
        ) : <span className="font-medium">{current?.name ?? '—'}</span>}
        {busy === 'wh' ? <Spinner /> : null}
      </div>
      {!d.shipped && current && !current.hasEverything ? (
        <p className="mt-2 flex items-start gap-1.5 text-warning-600">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {current.name} is short: {current.short.map((x) => `${x.sku} (needs ${x.need}, ${Math.max(0, x.free)} free)`).join(', ')}.
            {d.options.some((o) => o.hasEverything) ? ` ${d.options.filter((o) => o.hasEverything).map((o) => o.name).join(' or ')} has everything.` : ' Move stock there first (Warehouses → Move stock).'}
          </span>
        </p>
      ) : null}
    </div>
  );
}
