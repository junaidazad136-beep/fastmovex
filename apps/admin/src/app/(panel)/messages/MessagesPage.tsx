'use client';

import { Mail, Phone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, EmptyState, ErrorState, LoadMore, PageHeader, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

interface Message {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  orderNumber: string | null;
  userId: string | null;
  status: 'NEW' | 'HANDLED' | 'SPAM';
  note: string | null;
  handledAt: string | null;
  createdAt: string;
}

/** Messages from the website's Contact page. Reply by email or phone, then mark them handled. */
export function MessagesPage() {
  const { can } = useSession();
  const [f, setF, ready] = useUrlState({ status: 'NEW' });
  const list = useCursorList<Message>(ready ? `/admin/contact-messages${qs({ status: f.status })}` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { busy, run } = useAction();

  async function mark(m: Message, status: Message['status']) {
    const r = await run(`${m.id}-${status}`, () => api<Message>(`/admin/contact-messages/${m.id}`, { method: 'PATCH', body: { status, note: notes[m.id]?.trim() || undefined } }), status === 'HANDLED' ? 'Marked as handled' : status === 'SPAM' ? 'Marked as spam' : 'Moved back to new');
    if (r) {
      list.setItems((items) => (f.status ? items?.filter((x) => x.id !== m.id) : items?.map((x) => (x.id === m.id ? r : x))));
      summaryStale();
    }
  }

  return (
    <>
      <PageHeader title="Messages" description="Sent from the Contact page of the website. Reply by email or phone, then mark them as handled." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => { setOpen(null); setF({ status }); }} tabs={[{ value: 'NEW', label: 'New' }, { value: 'HANDLED', label: 'Handled' }, { value: 'SPAM', label: 'Spam' }, { value: '', label: 'All' }]} />
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        {!list.items && !list.error ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div> : null}
        <ul className="divide-y divide-ink-100">
          {list.items?.map((m) => {
            const expanded = open === m.id;
            return (
              <li key={m.id} className="px-5 py-4">
                <button type="button" className="flex w-full items-start gap-3 text-start" onClick={() => setOpen(expanded ? null : m.id)} aria-expanded={expanded}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-ink-900">{m.name}</span>
                      <span className="text-ink-500">{m.email}</span>
                      {m.userId ? <Badge tone="blue">Customer</Badge> : null}
                      {m.status !== 'NEW' ? <Badge tone={m.status === 'SPAM' ? 'red' : 'green'}>{m.status === 'SPAM' ? 'Spam' : 'Handled'}</Badge> : null}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-700"><span className="font-medium">{m.subject || 'No subject'}</span> — {m.message}</p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-400" title={formatDateTime(m.createdAt)}>{timeAgo(m.createdAt)}</span>
                </button>
                {expanded ? (
                  <div className="mt-3 space-y-3 rounded-xl bg-ink-25 p-4 text-sm">
                    <p className="whitespace-pre-line text-ink-800">{m.message}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-600">
                      <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject || 'Your message to FastMoveX'}`)}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Mail className="size-4" aria-hidden /> {m.email}</a>
                      {m.phone ? <a href={`tel:${m.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Phone className="size-4" aria-hidden /> {m.phone}</a> : null}
                      {m.orderNumber ? (can('orders.read') ? <Link href={`/orders/${m.orderNumber}`} className="link">Order {m.orderNumber}</Link> : <span>Order {m.orderNumber}</span>) : null}
                      {m.userId && can('users.read') ? <Link href={`/customers/${m.userId}`} className="link">Customer profile</Link> : null}
                    </div>
                    {m.note ? <p className="text-xs text-ink-500">Note: {m.note}</p> : null}
                    {can('tickets.reply') ? (
                      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                        <input className="input min-w-[200px] flex-1" placeholder="Internal note (optional), e.g. replied by phone" value={notes[m.id] ?? ''} onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })} maxLength={2000} aria-label="Internal note" />
                        {m.status !== 'HANDLED' ? <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => mark(m, 'HANDLED')}>Mark handled</button> : null}
                        {m.status !== 'SPAM' ? <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => mark(m, 'SPAM')}>Spam</button> : null}
                        {m.status !== 'NEW' ? <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => mark(m, 'NEW')}>Move to new</button> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {list.items?.length === 0 ? <EmptyState title={f.status === 'NEW' ? 'No new messages' : 'Nothing here'} /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
    </>
  );
}
