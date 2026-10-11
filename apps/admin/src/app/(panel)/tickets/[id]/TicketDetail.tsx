'use client';

import clsx from 'clsx';
import { Lock, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { Card, EmptyState, ErrorState, KeyValue, Loading, PageHeader, SelectField, Spinner, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api/client';
import { isNotFound } from '@/lib/api/errors';
import { formatDateTime, formatMoney, humanize } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useAction, useApi } from '@/lib/use-api';

interface Ticket {
  id: string;
  number: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  createdAt: string;
  userId: string;
  user: { id: string; fullName: string; email: string | null; phone: string | null };
  order: { orderNumber: string; status: string; totalMinor: string; currencyCode: string } | null;
  messages: { id: string; authorId: string; body: string; isInternal: boolean; createdAt: string; author: { fullName: string } }[];
}

export function TicketDetail({ id }: { id: string }) {
  const { user, can } = useSession();
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const t = useApi<Ticket>(valid ? `/admin/tickets/${id}` : null);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const { busy, run } = useAction();
  const canReply = can('tickets.reply');

  if (!valid || isNotFound(t.error)) return <EmptyState title="Ticket not found" action={<Link href="/tickets" className="btn-secondary">Back to tickets</Link>} />;
  if (t.error && !t.data) return <ErrorState error={t.error} onRetry={t.reload} />;
  if (!t.data) return <Loading />;
  const tk = t.data;

  async function send() {
    if (text.trim().length < 2) return;
    const ok = await run('send', () => api(`/admin/tickets/${tk.id}/messages`, { method: 'POST', body: { message: text.trim(), internal } }), internal ? 'Note added' : 'Reply sent to the customer');
    if (ok !== undefined) {
      setText('');
      t.reload();
    }
  }

  async function patch(body: Record<string, unknown>, msg: string) {
    const ok = await run('patch', () => api(`/admin/tickets/${tk.id}`, { method: 'PATCH', body }), msg);
    if (ok !== undefined) {
      t.reload();
      summaryStale();
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/tickets', label: 'Support tickets' }}
        title={tk.subject}
        description={<span className="flex flex-wrap items-center gap-2">{tk.number} <StatusBadge status={tk.status} /> <StatusBadge status={tk.priority} /> · {humanize(tk.category)} · opened {formatDateTime(tk.createdAt)}</span>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Card title="Conversation" bodyClassName="p-0">
            <ol className="space-y-4 p-5">
              {tk.messages.map((m) => {
                const fromCustomer = m.authorId === tk.userId;
                return (
                  <li key={m.id} className={clsx('flex', fromCustomer ? 'justify-start' : 'justify-end')}>
                    <div className={clsx('max-w-[85%] rounded-2xl px-4 py-2.5', m.isInternal ? 'border border-dashed border-sand-400 bg-sand-50' : fromCustomer ? 'bg-ink-100' : 'bg-brand-600 text-white')}>
                      <p className={clsx('mb-0.5 flex items-center gap-1 text-xs', m.isInternal ? 'text-sand-700' : fromCustomer ? 'text-ink-500' : 'text-white/75')}>
                        {m.isInternal ? <Lock className="size-3" aria-hidden /> : null}
                        {m.author.fullName}{m.isInternal ? ' · internal note' : ''} · {formatDateTime(m.createdAt)}
                      </p>
                      <p className="text-sm whitespace-pre-line">{m.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {canReply ? (
              <div className="border-t border-ink-100 p-4">
                <textarea
                  className={clsx('input min-h-24', internal && 'border-sand-400 bg-sand-50')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={internal ? 'Internal note: only staff can see it' : 'Reply to the customer…'}
                  aria-label={internal ? 'Internal note' : 'Reply'}
                  maxLength={5000}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" className="size-4 accent-brand-600" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                    Internal note (not sent to the customer)
                  </label>
                  <button type="button" className="btn-primary" onClick={send} disabled={busy === 'send' || text.trim().length < 2}>
                    {busy === 'send' ? <Spinner /> : <Send className="size-4" aria-hidden />} {internal ? 'Add note' : 'Send reply'}
                  </button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          {canReply ? (
            <Card title="Handling">
              <div className="space-y-4">
                <SelectField label="Status" value={tk.status} onChange={(e) => patch({ status: e.target.value }, 'Status updated')} disabled={!!busy}>
                  {['OPEN', 'PENDING_CUSTOMER', 'PENDING_SELLER', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </SelectField>
                <SelectField label="Priority" value={tk.priority} onChange={(e) => patch({ priority: e.target.value }, 'Priority updated')} disabled={!!busy}>
                  {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </SelectField>
                {tk.assignedToId !== user?.id ? (
                  <button type="button" className="btn-secondary w-full" disabled={!!busy} onClick={() => patch({ assignedToId: user?.id }, 'Assigned to you')}>Assign to me</button>
                ) : <p className="text-sm text-ink-600">Assigned to you.</p>}
              </div>
            </Card>
          ) : null}
          <Card title="Customer">
            <div className="space-y-1 text-sm">
              {can('users.read') ? <Link href={`/customers/${tk.user.id}`} className="link">{tk.user.fullName}</Link> : <p className="font-medium">{tk.user.fullName}</p>}
              {tk.user.email ? <p><a href={`mailto:${tk.user.email}`} className="text-ink-600 hover:underline">{tk.user.email}</a></p> : null}
              {tk.user.phone ? <p><a href={`tel:${tk.user.phone}`} className="text-ink-600 hover:underline">{tk.user.phone}</a></p> : null}
            </div>
          </Card>
          {tk.order ? (
            <Card title="Order">
              <KeyValue items={[
                ['Order', can('orders.read') ? <Link key="o" href={`/orders/${tk.order.orderNumber}`} className="link">{tk.order.orderNumber}</Link> : tk.order.orderNumber],
                ['Status', <StatusBadge key="s" status={tk.order.status} />],
                ['Total', formatMoney(tk.order.totalMinor, tk.order.currencyCode)],
              ]} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
