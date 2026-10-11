'use client';

import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ReturnRequest } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { paths } from '@/lib/urls';
import { EmptyState } from '../ui/EmptyState';

const TONE: Record<ReturnRequest['status'], string> = {
  REQUESTED: 'bg-warning-50 text-warning-600', APPROVED: 'bg-sky-50 text-sky-700', REJECTED: 'bg-danger-50 text-danger-600', RECEIVED: 'bg-sky-50 text-sky-700', REFUNDED: 'bg-success-50 text-success-700',
};

export function Returns() {
  const t = useT();
  const l = t.locale;
  const [items, setItems] = useState<ReturnRequest[] | null>(null);
  useEffect(() => { api<ReturnRequest[]>('/me/returns').then(setItems).catch(() => setItems([])); }, []);
  if (items === null) return <div className="skeleton h-40" />;
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{t('returns.title')}</h1>
      <p className="mb-4 text-sm text-ink-500">{t('returns.howTo')} <Link href={paths.returnsPolicy(l)} className="link">{t('help.returnsPolicy')}</Link></p>
      {items.length === 0 ? <EmptyState icon={<RotateCcw className="size-7" aria-hidden />} title={t('returns.empty')} /> : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="card p-4 text-sm" data-testid="return-row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.orderItem.productTitle}</p>
                  <Link href={paths.order(l, r.orderItem.order.orderNumber)} className="text-xs text-ink-500 hover:underline" dir="ltr">{r.orderItem.order.orderNumber}</Link>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[r.status]}`}>{t(`returns.status.${r.status}`)}</span>
              </div>
              <p className="mt-2 text-ink-600">{t('returns.qty', { n: r.quantity })} · {t('returns.reason', { reason: r.reason })}</p>
              {r.resolution && <p className="mt-1 text-ink-600">{t('returns.decisionNote', { note: r.resolution })}</p>}
              {r.pickup?.status === 'ASSIGNED' && r.status === 'APPROVED' && <p className="mt-1 font-medium text-sky-700" data-testid="return-pickup">{t('returns.pickup', { date: formatDate(r.pickup.date, l) })}</p>}
              {r.pickup?.status === 'COLLECTED' && r.status === 'APPROVED' && <p className="mt-1 font-medium text-sky-700" data-testid="return-pickup">{t('returns.pickupCollected')}</p>}
              <p className="mt-1 text-xs text-ink-400">{t('returns.requestedOn', { date: formatDate(r.createdAt, l) })}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
