'use client';

import { CheckCircle2, CircleAlert, Palmtree, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { Spinner } from '../ui/Spinner';
import { Field } from './BecomeSeller';
import { useDate } from './kit';

type State = 'good' | 'warn' | 'bad' | 'none';
type Key = 'cancellations' | 'lateDispatch' | 'returns' | 'rating' | 'questions';
interface Metric { key: Key; value: number | null; count: number; of: number; target: number; limit: number; days: number; state: State }
interface Health { status: 'good' | 'risk' | 'poor'; metrics: Metric[] }

const STATUS = {
  good: { Icon: CheckCircle2, cls: 'border-success-600/30 bg-success-50 text-success-700' },
  risk: { Icon: CircleAlert, cls: 'border-warning-600/30 bg-warning-50 text-warning-600' },
  poor: { Icon: XCircle, cls: 'border-danger-600/30 bg-danger-50 text-danger-600' },
} as const;
const STATE_CLS: Record<State, string> = { good: 'text-success-700', warn: 'text-warning-600', bad: 'text-danger-600', none: 'text-ink-400' };
const BAR_CLS: Record<State, string> = { good: 'bg-success-600', warn: 'bg-warning-600', bad: 'bg-danger-600', none: 'bg-ink-300' };

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%`;

/**
 * Account Health, as marketplaces judge sellers: cancellations, late packing, returns, ratings and answered questions,
 * each against a target. Stores that keep missing targets are reviewed by FastMoveX.
 */
export function SellerHealth() {
  const t = useT();
  const toast = useToast();
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => { api<Health>('/seller/health').then(setH).catch((e) => toast({ tone: 'error', message: errorMessage(e, t) })); }, [toast, t]);

  return (
    <div className="space-y-5" data-testid="seller-health">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.health.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('seller.health.lead')}</p>
      </div>
      {!h ? <div className="space-y-3" aria-busy="true"><div className="skeleton h-20 rounded-2xl" /><div className="skeleton h-40 rounded-2xl" /></div> : (
        <>
          {(() => { const { Icon, cls } = STATUS[h.status]; return (
            <div className={`flex items-start gap-3 rounded-2xl border p-4 ${cls}`} data-testid="health-status">
              <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
              <div><p className="text-lg font-bold">{t(`seller.health.status.${h.status}`)}</p><p className="text-sm text-ink-700">{t(`seller.health.statusText.${h.status}`)}</p></div>
            </div>
          ); })()}
          <ul className="grid gap-3 sm:grid-cols-2">
            {h.metrics.map((m) => <MetricCard key={m.key} m={m} />)}
          </ul>
          <p className="text-xs text-ink-500">{t('seller.health.note')}</p>
        </>
      )}
      <HolidayCard />
    </div>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const t = useT();
  const rating = m.key === 'rating';
  const higher = rating || m.key === 'questions';
  const shown = m.value === null ? '–' : rating ? m.value.toFixed(1) : pct(m.value);
  // the bar: how far along the scale up to twice the limit (or 5 stars / 100%)
  const scale = rating ? m.value !== null ? m.value / 5 : 0 : higher ? m.value ?? 0 : Math.min(1, (m.value ?? 0) / (m.limit * 2));
  const target = rating ? `${m.target.toFixed(1)}+` : higher ? `${pct(m.target)}+` : `${t('seller.health.under')} ${pct(m.target)}`;
  return (
    <li className="card p-4" data-testid={`health-${m.key}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink-900">{t(`seller.health.metric.${m.key}`)}</p>
        <span className={`text-xs font-semibold ${STATE_CLS[m.state]}`}>{t(`seller.health.state.${m.state}`)}</span>
      </div>
      <p className={`tabular mt-1 text-2xl font-extrabold ${STATE_CLS[m.state]}`}>{shown}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100"><div className={`h-full rounded-full ${BAR_CLS[m.state]}`} style={{ width: `${Math.max(2, scale * 100)}%` }} /></div>
      <p className="mt-2 text-xs text-ink-500">
        {t('seller.health.target', { target })} · {m.state === 'none' && m.of === 0 ? t('seller.health.noData', { days: m.days }) : t(`seller.health.count.${m.key}`, { n: m.count, of: m.of, days: m.days })}
      </p>
      {(m.state === 'warn' || m.state === 'bad') && <p className="mt-2 rounded-lg bg-ink-50 px-2.5 py-2 text-xs text-ink-700">{t(`seller.health.tip.${m.key}`)}</p>}
    </li>
  );
}

/** Holiday mode: close the store until a date. Products leave the shop and come back by themselves on that date. */
export function HolidayCard() {
  const t = useT();
  const toast = useToast();
  const date = useDate();
  const [state, setState] = useState<{ awayUntil: string | null; awayMessage: string | null } | null>(null);
  const [until, setUntil] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ awayUntil: string | null; awayMessage: string | null }>('/seller/away').then(setState).catch(() => setState({ awayUntil: null, awayMessage: null })), []);
  useEffect(() => { void load(); }, [load]);

  async function save(on: boolean) {
    setBusy(true);
    try {
      const r = await api<{ awayUntil: string | null; awayMessage: string | null }>('/seller/away', {
        method: 'PUT', body: on ? { until: new Date(`${until}T23:59:00`).toISOString(), ...(message.trim() && { message: message.trim() }) } : { until: null },
      });
      setState(r);
      window.dispatchEvent(new Event('fmx:away'));
      toast({ tone: 'success', message: on ? t('seller.holiday.onToast') : t('seller.holiday.offToast') });
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(false); }
  }

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const max = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  return (
    <section className="card space-y-3 p-5" data-testid="holiday-card">
      <h2 className="flex items-center gap-2 font-semibold"><Palmtree className="size-5 text-brand-600" aria-hidden />{t('seller.holiday.title')}</h2>
      {!state ? <div className="skeleton h-16" /> : state.awayUntil ? (
        <>
          <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm font-medium text-warning-600" data-testid="holiday-on">{t('seller.holiday.closedUntil', { date: date(state.awayUntil) })}</p>
          {state.awayMessage && <p className="text-sm text-ink-600">“{state.awayMessage}”</p>}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => save(false)} data-testid="holiday-off">{busy && <Spinner className="size-4" />}{t('seller.holiday.openNow')}</button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-600">{t('seller.holiday.lead')}</p>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Field id="away-until" label={t('seller.holiday.until')}><input id="away-until" type="date" className="input" min={tomorrow} max={max} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
            <Field id="away-msg" label={t('seller.holiday.message')}><input id="away-msg" className="input" maxLength={200} dir="auto" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('seller.holiday.messagePlaceholder')} /></Field>
          </div>
          <p className="hint">{t('seller.holiday.openOrders')}</p>
          <button type="button" className="btn-secondary" disabled={busy || !until} onClick={() => save(true)} data-testid="holiday-on-save">{busy && <Spinner className="size-4" />}{t('seller.holiday.turnOn')}</button>
        </>
      )}
    </section>
  );
}

/** A strip at the top of every Seller Center page while the store is closed for a holiday. */
export function AwayBanner({ href }: { href: string }) {
  const t = useT();
  const date = useDate();
  const [until, setUntil] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api<{ awayUntil: string | null }>('/seller/away').then((r) => setUntil(r.awayUntil)).catch(() => undefined);
    void load();
    window.addEventListener('fmx:away', load);
    return () => window.removeEventListener('fmx:away', load);
  }, []);
  if (!until) return null;
  return (
    <a href={href} className="mb-4 flex items-center gap-2 rounded-2xl border border-warning-600/30 bg-warning-50 px-4 py-3 text-sm font-semibold text-warning-600" data-testid="away-banner">
      <Palmtree className="size-5 shrink-0" aria-hidden />{t('seller.holiday.banner', { date: date(until) })}
    </a>
  );
}
