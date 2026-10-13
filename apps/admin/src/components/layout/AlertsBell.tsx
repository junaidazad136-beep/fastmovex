'use client';

import clsx from 'clsx';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { timeAgo } from '@/lib/format';

export interface Alert { id: string; type: string; title: string; body: string; data: { link?: string } | null; readAt: string | null; createdAt: string }

/** Where an alert leads in the admin panel (only our own relative paths). */
export const alertHref = (a: Alert) => (typeof a.data?.link === 'string' && a.data.link.startsWith('/') && !a.data.link.startsWith('//') ? a.data.link : '/alerts');

/** Header bell: unread count (checked every minute) and the latest alerts. */
export function AlertsBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Alert[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      api<{ unread: number }>('/me/notifications/unread-count').then((r) => !stop && setUnread(r.unread)).catch(() => undefined);
    };
    load();
    const id = setInterval(load, 60_000);
    window.addEventListener('fmx:summary-stale', load);
    return () => { stop = true; clearInterval(id); window.removeEventListener('fmx:summary-stale', load); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    api<{ items: Alert[] }>('/me/notifications').then((r) => setItems(r.items.slice(0, 8))).catch(() => setItems([]));
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  async function go(a: Alert) {
    setOpen(false);
    if (!a.readAt) {
      const r = await api<{ unread: number }>(`/me/notifications/${a.id}/read`, { method: 'POST' }).catch(() => null);
      if (r) setUnread(r.unread);
    }
    router.push(alertHref(a));
  }
  async function readAll() {
    const r = await api<{ unread: number }>('/me/notifications/read-all', { method: 'POST' }).catch(() => null);
    if (r) { setUnread(r.unread); setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null); }
  }

  return (
    <div className="relative" ref={box}>
      <button type="button" className="relative rounded-lg p-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900" onClick={() => setOpen(!open)}
        aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'} aria-expanded={open} data-testid="alerts-bell">
        <Bell className="size-[18px]" aria-hidden />
        {unread ? <span className="absolute -end-0.5 -top-0.5 min-w-[18px] rounded-full bg-danger-600 px-1 text-center text-[10px] leading-[18px] font-bold text-white tabular" data-testid="alerts-unread">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-40 mt-2 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-ink-100 bg-white shadow-[var(--shadow-pop)]" role="dialog" aria-label="Alerts">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
            <p className="text-sm font-semibold">Alerts</p>
            {unread ? <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={readAll}>Mark all read</button> : null}
          </div>
          <ul className="max-h-[420px] divide-y divide-ink-100 overflow-y-auto" data-testid="alerts-menu">
            {items === null ? <li className="flex justify-center p-6"><Spinner /></li> : null}
            {items?.length === 0 ? <li className="p-6 text-center text-sm text-ink-500">No alerts yet.</li> : null}
            {items?.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => void go(a)} className={clsx('flex w-full gap-2.5 px-4 py-3 text-start hover:bg-ink-50', !a.readAt && 'bg-brand-50/40')}>
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', a.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{a.title}</span>
                    <span className="line-clamp-2 block text-xs text-ink-600">{a.body}</span>
                    <span className="block text-[11px] text-ink-400">{timeAgo(a.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/alerts" onClick={() => setOpen(false)} className="block border-t border-ink-100 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-ink-50">All alerts & settings</Link>
        </div>
      ) : null}
    </div>
  );
}
