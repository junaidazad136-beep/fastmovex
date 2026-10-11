'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, Spinner, Switch } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useToast } from '@/lib/state/toast';
import { useAction } from '@/lib/use-api';

export interface SlotWindow { start: string; end: string; capacity: number }
export interface SlotConfig {
  enabled: boolean;
  required: boolean;
  daysAhead: number;
  leadMinutes: number;
  closedWeekdays: number[];
  closedDates: string[];
  windows: SlotWindow[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT: SlotConfig = {
  enabled: false, required: false, daysAhead: 3, leadMinutes: 120, closedWeekdays: [], closedDates: [],
  windows: [{ start: '09:00', end: '13:00', capacity: 20 }, { start: '13:00', end: '17:00', capacity: 20 }, { start: '17:00', end: '21:00', capacity: 20 }],
};
const LEAD = [[0, 'No minimum'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '1 day']] as const;

function fromStored(raw: unknown): SlotConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<SlotConfig>;
  return {
    ...DEFAULT, ...c,
    closedWeekdays: Array.isArray(c.closedWeekdays) ? c.closedWeekdays : [],
    closedDates: Array.isArray(c.closedDates) ? c.closedDates : [],
    windows: Array.isArray(c.windows) && c.windows.length ? c.windows : DEFAULT.windows,
  };
}

/** Delivery time windows offered at checkout, with how many orders each can take. Saved on its own. */
export function DeliverySlotsCard({ countryCode, stored, onSaved }: { countryCode: string; stored: unknown; onSaved: () => void }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [c, setC] = useState<SlotConfig>(() => fromStored(stored));
  const [holiday, setHoliday] = useState('');
  useEffect(() => setC(fromStored(stored)), [stored]);
  const set = (p: Partial<SlotConfig>) => setC((x) => ({ ...x, ...p }));
  const setWindow = (i: number, p: Partial<SlotWindow>) => set({ windows: c.windows.map((w, j) => (j === i ? { ...w, ...p } : w)) });

  async function save() {
    if (c.enabled && !c.windows.length) return toast.error('Add at least one delivery window');
    for (const w of c.windows) {
      if (!w.start || !w.end || w.end <= w.start) return toast.error(`Window ${w.start || '?'}–${w.end || '?'} must end after it starts`);
      if (!(w.capacity >= 1)) return toast.error('Each window needs at least 1 order');
    }
    const r = await run('slots', () => api(`/admin/countries/${countryCode}`, { method: 'PATCH', body: { deliverySlots: c } }), c.enabled ? 'Delivery times saved. Customers choose them at checkout.' : 'Delivery times turned off.');
    if (r !== undefined) onSaved();
  }

  return (
    <Card title="Delivery times" description="Let customers choose when their order arrives. Each window takes a limited number of orders." className="xl:col-span-2">
      <div className="space-y-5" data-testid="slots-card">
        <div className="grid gap-4 md:grid-cols-2">
          <Switch checked={c.enabled} onChange={(enabled) => set({ enabled })} label="Customers choose a delivery time" description="Shown at checkout for every order." />
          {c.enabled ? <Switch checked={c.required} onChange={(required) => set({ required })} label="A delivery time is required" description="Off = “As soon as possible” is also offered." /> : null}
        </div>
        {c.enabled ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="label">Days offered</span>
                <select className="input" value={c.daysAhead} onChange={(e) => set({ daysAhead: Number(e.target.value) })} aria-label="Days offered">
                  {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'Today only' : `${n} days (today + ${n - 1})`}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Book at least</span>
                <select className="input" value={c.leadMinutes} onChange={(e) => set({ leadMinutes: Number(e.target.value) })} aria-label="Book at least">
                  {LEAD.map(([v, l]) => <option key={v} value={v}>{v ? `${l} before` : l}</option>)}
                </select>
              </label>
              <fieldset className="sm:col-span-2">
                <legend className="label">Days without delivery</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const on = c.closedWeekdays.includes(i);
                    return (
                      <button key={d} type="button" aria-pressed={on} onClick={() => set({ closedWeekdays: on ? c.closedWeekdays.filter((x) => x !== i) : [...c.closedWeekdays, i].sort() })}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${on ? 'border-danger-600/40 bg-danger-50 text-danger-600' : 'border-ink-200 text-ink-700 hover:border-ink-300'}`}>{d}</button>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <div>
              <p className="label">Delivery windows (Qatar time)</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead><tr className="text-start text-xs text-ink-500"><th className="pb-1 text-start font-medium">From</th><th className="pb-1 text-start font-medium">To</th><th className="pb-1 text-start font-medium">Orders per window</th><th className="w-10" /></tr></thead>
                  <tbody>
                    {c.windows.map((w, i) => (
                      <tr key={i}>
                        <td className="py-1 pe-2"><input type="time" step={900} className="input py-1.5" value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} aria-label={`Window ${i + 1} from`} /></td>
                        <td className="py-1 pe-2"><input type="time" step={900} className="input py-1.5" value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} aria-label={`Window ${i + 1} to`} /></td>
                        <td className="py-1 pe-2"><input type="number" min={1} max={10000} className="input py-1.5" value={w.capacity} onChange={(e) => setWindow(i, { capacity: Number(e.target.value) })} aria-label={`Window ${i + 1} orders`} /></td>
                        <td className="py-1"><button type="button" className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => set({ windows: c.windows.filter((_, j) => j !== i) })} aria-label={`Remove window ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {c.windows.length < 12 ? (
                <button type="button" className="btn-ghost btn-sm mt-1 text-brand-700" onClick={() => set({ windows: [...c.windows, { start: c.windows.at(-1)?.end ?? '09:00', end: '', capacity: c.windows.at(-1)?.capacity ?? 20 }] })}>
                  <Plus className="size-4" aria-hidden /> Add window
                </button>
              ) : null}
            </div>

            <div>
              <p className="label">Holidays (no delivery)</p>
              <div className="flex flex-wrap items-center gap-2">
                {c.closedDates.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-xs">
                    {d}<button type="button" onClick={() => set({ closedDates: c.closedDates.filter((x) => x !== d) })} aria-label={`Remove ${d}`} className="text-ink-500 hover:text-danger-600">×</button>
                  </span>
                ))}
                <input type="date" className="input w-auto py-1.5" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label="Holiday date" />
                <button type="button" className="btn-secondary btn-sm" disabled={!holiday || c.closedDates.includes(holiday)} onClick={() => { set({ closedDates: [...c.closedDates, holiday].sort() }); setHoliday(''); }}>Add holiday</button>
              </div>
            </div>
          </>
        ) : null}
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={save} disabled={busy === 'slots'}>{busy === 'slots' ? <Spinner /> : null} Save delivery times</button>
        </div>
      </div>
    </Card>
  );
}
