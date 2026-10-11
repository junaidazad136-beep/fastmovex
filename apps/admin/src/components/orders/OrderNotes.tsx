'use client';

import { Pin } from 'lucide-react';
import { useState } from 'react';
import { Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import type { Note } from '@/components/customers/CustomerNotes';

interface OrderNotes { items: Note[]; customer: { id: string; tags: string[]; pinnedNote: Note | null } | null }

/** The customer's pinned note, shown where whoever handles the order cannot miss it. */
export function PinnedCustomerNote({ orderNumber }: { orderNumber: string }) {
  const r = useApi<OrderNotes>(`/admin/orders/${encodeURIComponent(orderNumber)}/notes`);
  const n = r.data?.customer?.pinnedNote;
  if (!n) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm" data-testid="pinned-note">
      <Pin className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-ink-900">Note about this customer</p>
        <p className="whitespace-pre-wrap text-ink-800">{n.body}</p>
        <p className="mt-1 text-xs text-ink-500">{n.author.fullName} · {formatDateTime(n.createdAt)}</p>
      </div>
    </div>
  );
}

/** Staff notes on this order ("customer called, leave with the guard"). Never shown to the customer. */
export function OrderNotesCard({ orderNumber }: { orderNumber: string }) {
  const r = useApi<OrderNotes>(`/admin/orders/${encodeURIComponent(orderNumber)}/notes`);
  const [body, setBody] = useState('');
  const { busy, run } = useAction();
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const ok = await run('note', () => api(`/admin/orders/${encodeURIComponent(orderNumber)}/notes`, { method: 'POST', body: { body } }), 'Note added');
    if (ok) { setBody(''); r.reload(); }
  }
  return (
    <Card title="Staff notes" description="Only staff see these.">
      <form onSubmit={add} className="space-y-2" data-testid="order-note-form">
        <textarea className="input min-h-[60px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="e.g. Customer called: leave it with the building guard" aria-label="New order note" />
        <div className="flex justify-end"><button type="submit" className="btn-primary btn-sm" disabled={!body.trim() || busy === 'note'}>{busy === 'note' ? <Spinner /> : null}Add note</button></div>
      </form>
      <ul className="mt-3 space-y-2.5" data-testid="order-notes">
        {r.data?.items.map((n) => (
          <li key={n.id} className="border-s-2 border-ink-200 ps-3 text-sm">
            <p className="whitespace-pre-wrap text-ink-800">{n.body}</p>
            <p className="text-xs text-ink-500">{n.author.fullName} · {formatDateTime(n.createdAt)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
