'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { Notification, Paged } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';
import { paths } from '@/lib/urls';
import { EmptyState } from '../ui/EmptyState';

/** "Notifications on this browser": order updates as system notifications (Web Push), when the shop has it set up. */
function BrowserPush() {
  const t = useT();
  const [cfg, setCfg] = useState<{ enabled: boolean; publicKey: string | null } | null>(null);
  const [state, setState] = useState<'unknown' | 'on' | 'off' | 'blocked' | 'unsupported'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ enabled: boolean; publicKey: string | null }>('/me/push').then(setCfg).catch(() => setCfg(null));
    if (!pushSupported()) { setState('unsupported'); return; }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    currentSubscription().then((s) => setState(s ? 'on' : 'off')).catch(() => setState('off'));
  }, []);
  if (!cfg?.enabled || !cfg.publicKey || state === 'unknown') return null;
  async function toggle(on: boolean) {
    setBusy(true); setError('');
    try {
      if (on) setState(await enablePush(cfg!.publicKey!));
      else { await disablePush(); setState('off'); }
    } catch { setError(t('notifications.browserFailed')); } finally { setBusy(false); }
  }
  return (
    <section className="card mb-4 p-4" data-testid="browser-push">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-4 accent-brand-600" checked={state === 'on'} disabled={busy || state === 'unsupported' || state === 'blocked'} onChange={(e) => toggle(e.target.checked)} data-testid="browser-push-toggle" />
        <span>
          <span className="block font-semibold">{t('notifications.browser')}</span>
          <span className="block text-sm text-ink-500">
            {state === 'unsupported' ? t('notifications.browserUnsupported') : state === 'blocked' ? t('notifications.browserBlocked') : state === 'on' ? t('notifications.browserOn') : t('notifications.browserHint')}
          </span>
          {error && <span className="field-error block" role="alert">{error}</span>}
        </span>
      </label>
    </section>
  );
}

export function Notifications() {
  const t = useT();
  const l = t.locale;
  const [items, setItems] = useState<Notification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const changed = () => window.dispatchEvent(new Event('jovia:notifications-changed'));

  const load = useCallback(async (after: string | null) => {
    const page = await api<Paged<Notification>>(`/me/notifications${after ? `?cursor=${encodeURIComponent(after)}` : ''}`);
    setItems((x) => (after ? [...(x ?? []), ...page.items] : page.items));
    setCursor(page.nextCursor);
  }, []);
  useEffect(() => { load(null).catch(() => setItems([])); }, [load]);

  async function markAll() {
    await api('/me/notifications/read-all', { method: 'POST' });
    setItems((x) => x?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    changed();
  }
  async function open(n: Notification) {
    if (n.readAt) return;
    await api(`/me/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    setItems((x) => x?.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)) ?? null);
    changed();
  }

  if (items === null) return <div className="skeleton h-40" />;
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('notifications.title')}</h1>
        {unread > 0 && <button type="button" onClick={markAll} className="btn-ghost text-sm">{t('notifications.markAllRead')}</button>}
      </div>
      <BrowserPush />
      {items.length === 0 ? <EmptyState icon={<Bell className="size-7" aria-hidden />} title={t('notifications.empty')} /> : (
        <ul className="card divide-y divide-ink-100">
          {items.map((n) => {
            const body = (
              <div className="flex gap-3 p-4">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} aria-hidden />
                <div className="min-w-0">
                  <p className={`text-sm ${n.readAt ? 'text-ink-700' : 'font-semibold text-ink-900'}`}>{n.title}</p>
                  <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
                  <p className="mt-1 text-xs text-ink-400">{formatDateTime(n.createdAt, l)}</p>
                </div>
              </div>
            );
            const order = typeof n.data?.orderNumber === 'string' ? n.data.orderNumber : null;
            return (
              <li key={n.id}>
                {order ? <Link href={paths.order(l, order)} onClick={() => open(n)} className="block hover:bg-ink-25">{body}</Link> : <button type="button" onClick={() => open(n)} className="block w-full text-start hover:bg-ink-25">{body}</button>}
              </li>
            );
          })}
        </ul>
      )}
      {cursor && <button type="button" onClick={() => load(cursor)} className="btn-secondary mt-4">{t('common.loadMore')}</button>}
    </div>
  );
}
