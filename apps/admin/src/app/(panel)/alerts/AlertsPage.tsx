'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { alertHref, type Alert } from '@/components/layout/AlertsBell';
import { summaryStale } from '@/components/layout/Shell';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';

type Mode = 'off' | 'app' | 'email';
interface Prefs { emailAvailable: boolean; alerts: { type: string; label: string; hint: string; mode: Mode }[] }

/** Every alert for this staff member, and which alerts they get, and how. */
export function AlertsPage() {
  const [items, setItems] = useState<Alert[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const prefs = useApi<Prefs>('/me/alert-prefs');
  const { busy, run } = useAction();

  async function load(after?: string | null) {
    setMore(true);
    try {
      const r = await api<{ items: Alert[]; nextCursor: string | null }>(`/me/notifications${after ? `?cursor=${encodeURIComponent(after)}` : ''}`);
      setItems((xs) => (after && xs ? [...xs, ...r.items] : r.items));
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) { setError(e); } finally { setMore(false); }
  }
  useEffect(() => { void load(); }, []);

  async function readAll() {
    const r = await run('read', () => api('/me/notifications/read-all', { method: 'POST' }), 'All marked as read');
    if (r) { setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null); summaryStale(); }
  }
  async function setMode(type: string, mode: Mode) {
    const r = await run(type, () => api<Prefs>('/me/alert-prefs', { method: 'PATCH', body: { prefs: { [type]: mode } } }), 'Saved');
    if (r) prefs.setData(r);
  }
  async function open(a: Alert) {
    if (!a.readAt) await api(`/me/notifications/${a.id}/read`, { method: 'POST' }).catch(() => undefined);
    summaryStale();
  }

  return (
    <>
      <PageHeader title="Alerts" description="New orders, failed deliveries, refunds to approve, low stock and more — as they happen."
        actions={<button type="button" className="btn-secondary" onClick={readAll} disabled={busy === 'read'}>{busy === 'read' ? <Spinner /> : null}Mark all read</button>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card bodyClassName="p-0" className="xl:col-span-2">
          {error ? <ErrorState error={error} onRetry={() => void load()} /> : null}
          <ul className="divide-y divide-ink-100" data-testid="alerts-list">
            {!items && !error ? <li><table className="w-full"><tbody><SkeletonRows cols={1} /></tbody></table></li> : null}
            {items?.map((a) => (
              <li key={a.id} className={clsx(!a.readAt && 'bg-brand-50/40')}>
                <Link href={alertHref(a)} onClick={() => void open(a)} className="flex gap-3 px-5 py-3.5 hover:bg-ink-50">
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', a.readAt ? 'bg-ink-200' : 'bg-brand-600')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-900">{a.title}</span>
                    <span className="block text-sm text-ink-600">{a.body}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">{formatDateTime(a.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {items?.length === 0 ? <EmptyState title="No alerts yet" description="They appear here and on the bell at the top." /> : null}
          {cursor ? <div className="border-t border-ink-100 p-3 text-center"><button type="button" className="btn-ghost" onClick={() => void load(cursor)} disabled={more}>{more ? <Spinner /> : null}Load more</button></div> : null}
        </Card>
        <Card title="What I get" description={prefs.data && !prefs.data.emailAvailable ? 'Email is not set up on this server yet — alerts come to the bell only.' : 'Choose per alert: off, the bell only, or the bell and an email.'}>
          {prefs.error ? <ErrorState error={prefs.error} onRetry={prefs.reload} /> : null}
          <ul className="space-y-4" data-testid="alert-prefs">
            {prefs.data?.alerts.map((p) => (
              <li key={p.type}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-medium text-ink-900">{p.label}</p><p className="text-xs text-ink-500">{p.hint}</p></div>
                  <div className="inline-flex shrink-0 rounded-lg border border-ink-200 p-0.5" role="radiogroup" aria-label={p.label}>
                    {(['off', 'app', 'email'] as Mode[]).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={p.mode === m} disabled={busy === p.type}
                        className={clsx('rounded-md px-2 py-1 text-xs font-medium', p.mode === m ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100')}
                        onClick={() => p.mode !== m && void setMode(p.type, m)} data-testid={`pref-${p.type}-${m}`}>
                        {m === 'off' ? 'Off' : m === 'app' ? 'Bell' : 'Bell + email'}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
            {prefs.data?.alerts.length === 0 ? <li className="text-sm text-ink-500">Your role has no staff alerts.</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}
