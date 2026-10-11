'use client';

import { useEffect, useState } from 'react';
import { Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { decimalToMinor, minorToDecimalString } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

interface Rules { phoneCheck: 'OFF' | 'GUESTS' | 'ALL'; maxOrderMinor: string | null; maxOpenOrders: number | null; refusalLimit: number | null; driverCashLimitMinor: string | null }
const DEFAULTS: Rules = { phoneCheck: 'GUESTS', maxOrderMinor: null, maxOpenOrders: null, refusalLimit: 2, driverCashLimitMinor: null };
const read = (raw: unknown): Rules => ({ ...DEFAULTS, ...((raw && typeof raw === 'object' ? raw : {}) as Partial<Rules>) });

/** Fake cash-on-delivery orders cost a driver trip and hold stock; these rules keep them out, and keep drivers' cash small. */
export function CodRulesCard({ countryCode, currency, stored, onSaved }: { countryCode: string; currency: string; stored: unknown; onSaved: () => void }) {
  const { busy, run } = useAction();
  const integrations = useApi<{ sms: boolean }>('/admin/countries/integrations');
  const [r, setR] = useState<Rules>(() => read(stored));
  const [maxOrder, setMaxOrder] = useState('');
  const [cashLimit, setCashLimit] = useState('');
  useEffect(() => {
    const v = read(stored);
    setR(v);
    setMaxOrder(v.maxOrderMinor ? minorToDecimalString(v.maxOrderMinor) : '');
    setCashLimit(v.driverCashLimitMinor ? minorToDecimalString(v.driverCashLimitMinor) : '');
  }, [stored]);

  async function save() {
    const maxOrderMinor = maxOrder.trim() ? decimalToMinor(maxOrder) : null;
    const driverCashLimitMinor = cashLimit.trim() ? decimalToMinor(cashLimit) : null;
    const body = { codRules: { ...r, maxOrderMinor, driverCashLimitMinor } };
    const ok = await run('cod', async () => {
      if ((maxOrder.trim() && !maxOrderMinor) || (cashLimit.trim() && !driverCashLimitMinor)) throw new ApiError(400, { message: 'Enter amounts like 1500 or 1500.50' });
      return api(`/admin/countries/${countryCode}`, { method: 'PATCH', body });
    }, 'Cash-on-delivery rules saved');
    if (ok !== undefined) onSaved();
  }
  const num = (v: string) => (v === '' ? null : Math.max(1, Math.round(Number(v))));

  return (
    <Card title="Cash on delivery safety" description="Stops fake cash orders and keeps the cash drivers carry small. Card payments are never limited." className="xl:col-span-2">
      <div className="space-y-4" data-testid="cod-rules">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="label">Confirm mobile by SMS code</span>
            <select className="input" value={r.phoneCheck} onChange={(e) => setR({ ...r, phoneCheck: e.target.value as Rules['phoneCheck'] })} aria-label="Confirm mobile by SMS code">
              <option value="GUESTS">Guests (recommended)</option>
              <option value="ALL">Everyone paying cash</option>
              <option value="OFF">Off</option>
            </select>
            {r.phoneCheck !== 'OFF' && integrations.data && !integrations.data.sms ? <span className="mt-1 block text-xs text-danger-600">SMS is not connected: guests cannot pay cash until it is.</span> : null}
          </label>
          <label className="block">
            <span className="label">Largest cash order ({currency})</span>
            <input className="input" inputMode="decimal" value={maxOrder} onChange={(e) => setMaxOrder(e.target.value)} placeholder="No limit" aria-label="Largest cash order" />
            <span className="mt-1 block text-xs text-ink-500">Bigger orders pay by card.</span>
          </label>
          <label className="block">
            <span className="label">Open cash orders per customer</span>
            <input className="input" type="number" min={1} max={50} value={r.maxOpenOrders ?? ''} onChange={(e) => setR({ ...r, maxOpenOrders: num(e.target.value) })} placeholder="No limit" aria-label="Open cash orders per customer" />
            <span className="mt-1 block text-xs text-ink-500">Undelivered cash orders at the same time (per account or phone).</span>
          </label>
          <label className="block">
            <span className="label">Refusals before COD is switched off</span>
            <input className="input" type="number" min={1} max={20} value={r.refusalLimit ?? ''} onChange={(e) => setR({ ...r, refusalLimit: num(e.target.value) })} placeholder="Never" aria-label="Refusals before COD is switched off" />
            <span className="mt-1 block text-xs text-ink-500">Counted when the driver reports “refused at the door”.</span>
          </label>
          <label className="block">
            <span className="label">Driver cash limit ({currency})</span>
            <input className="input" inputMode="decimal" value={cashLimit} onChange={(e) => setCashLimit(e.target.value)} placeholder="No limit" aria-label="Driver cash limit" />
            <span className="mt-1 block text-xs text-ink-500">Holding this much, a driver must hand over before picking up more.</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={save} disabled={busy === 'cod'}>{busy === 'cod' ? <Spinner /> : null} Save COD rules</button>
        </div>
      </div>
    </Card>
  );
}
