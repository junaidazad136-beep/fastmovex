'use client';

import { useEffect, useState } from 'react';
import { Card, Spinner, Stat, Switch } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatMoney, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useAction, useApi } from '@/lib/use-api';

interface Config { enabled: boolean; firstAfterMinutes: number; secondAfterHours: number | null; quietFrom: number; quietTo: number }
interface Stats { days: number; reminders: number; recoveredOrders: number; recoveredMinor: string; conversionPercent: number }

const FIRST = [[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [720, '12 hours'], [1440, '1 day']] as const;
const SECOND = [[0, 'No second reminder'], [24, '1 day after the first'], [48, '2 days after the first'], [72, '3 days after the first']] as const;
const read = (raw: unknown): Config => {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Config>;
  return { enabled: !!c.enabled, firstAfterMinutes: c.firstAfterMinutes ?? 60, secondAfterHours: c.secondAfterHours === undefined ? 24 : c.secondAfterHours, quietFrom: c.quietFrom ?? 21, quietTo: c.quietTo ?? 9 };
};

/** Abandoned-cart reminders: when they go out, and what they brought back. */
export function CartRemindersCard({ countryCode, currency, stored, onSaved }: { countryCode: string; currency: string; stored: unknown; onSaved: () => void }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const [c, setC] = useState<Config>(() => read(stored));
  useEffect(() => setC(read(stored)), [stored]);
  const stats = useApi<Stats>(can('analytics.read') ? '/admin/cart-reminders/stats?days=30' : null);

  async function save() {
    const r = await run('reminders', () => api(`/admin/countries/${countryCode}`, { method: 'PATCH', body: { cartReminders: c } }), c.enabled ? 'Cart reminders are on.' : 'Cart reminders are off.');
    if (r !== undefined) onSaved();
  }

  return (
    <Card title="Cart reminders" description="Remind customers who left items in their cart. Sent by email and WhatsApp, only to customers who agreed to offers." className="xl:col-span-2">
      <div className="space-y-5" data-testid="reminders-card">
        {stats.data ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Reminders sent (30 days)" value={formatNumber(stats.data.reminders)} />
            <Stat label="Orders after a reminder" value={formatNumber(stats.data.recoveredOrders)} sub={stats.data.reminders ? `${stats.data.conversionPercent}% of reminders` : undefined} />
            <Stat label="Sales brought back" value={formatMoney(stats.data.recoveredMinor, currency)} />
          </div>
        ) : null}
        <Switch checked={c.enabled} onChange={(enabled) => setC({ ...c, enabled })} label="Send cart reminders" description="A customer gets at most one reminder a day, never at night, and never again once they change the cart or order." />
        {c.enabled ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="label">First reminder</span>
              <select className="input" value={c.firstAfterMinutes} onChange={(e) => setC({ ...c, firstAfterMinutes: Number(e.target.value) })} aria-label="First reminder">
                {FIRST.map(([v, l]) => <option key={v} value={v}>{l} after the last change</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Second reminder</span>
              <select className="input" value={c.secondAfterHours ?? 0} onChange={(e) => setC({ ...c, secondAfterHours: Number(e.target.value) || null })} aria-label="Second reminder">
                {SECOND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <div className="block">
              <span className="label">Quiet hours (Qatar time)</span>
              <div className="flex items-center gap-2 text-sm">
                <select className="input" value={c.quietFrom} onChange={(e) => setC({ ...c, quietFrom: Number(e.target.value) })} aria-label="Quiet from">{hours()}</select>
                <span>to</span>
                <select className="input" value={c.quietTo} onChange={(e) => setC({ ...c, quietTo: Number(e.target.value) })} aria-label="Quiet to">{hours()}</select>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={save} disabled={busy === 'reminders'}>{busy === 'reminders' ? <Spinner /> : null} Save cart reminders</button>
        </div>
      </div>
    </Card>
  );
}

const hours = () => Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>);
