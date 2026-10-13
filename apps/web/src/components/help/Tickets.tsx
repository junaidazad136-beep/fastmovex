'use client';

import { LifeBuoy, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { isNotFound } from '@/lib/api/errors';
import type { TicketDetail, TicketStatus, TicketSummary } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { Field, FormError } from '../auth/fields';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';

const CATEGORIES = ['order', 'delivery', 'payment', 'refund', 'return', 'account', 'seller', 'other'] as const;
const ORDER_NO = /^(?:FMX|JV)-[A-Z]{2}-\d{6}-[A-Z0-9]{6}$/; // JV- = numbers from before the FastMoveX name

function StatusPill({ status }: { status: TicketStatus }) {
  const t = useT();
  const tone = status === 'PENDING_CUSTOMER' ? 'bg-warning-50 text-warning-600' : status === 'RESOLVED' || status === 'CLOSED' ? 'bg-ink-100 text-ink-600' : 'bg-sky-50 text-sky-700';
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{t(`help.status.${status}`)}</span>;
}

export function TicketList() {
  const t = useT();
  const l = t.locale;
  const [items, setItems] = useState<TicketSummary[] | null>(null);
  useEffect(() => { api<TicketSummary[]>('/support/tickets').then(setItems).catch(() => setItems([])); }, []);
  if (items === null) return <div className="skeleton h-40" />;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('help.myTickets')}</h1>
        <Link href={paths.newTicket(l)} className="btn-primary"><Plus className="size-4" aria-hidden />{t('help.newTicket')}</Link>
      </div>
      {items.length === 0 ? <EmptyState icon={<LifeBuoy className="size-7" aria-hidden />} title={t('help.ticketsEmpty')} /> : (
        <ul className="card divide-y divide-ink-100">
          {items.map((tk) => (
            <li key={tk.number}>
              <Link href={paths.ticket(l, tk.number)} className="flex items-center justify-between gap-3 p-4 hover:bg-ink-25">
                <div className="min-w-0">
                  <p className="truncate font-medium">{tk.subject}</p>
                  <p className="text-xs text-ink-500"><span dir="ltr">{tk.number}</span> · {formatDateTime(tk.updatedAt, l)}</p>
                </div>
                <StatusPill status={tk.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewTicket() {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const [form, setForm] = useState({ subject: '', category: params.get('order') ? 'order' : 'other', message: '', orderNumber: params.get('order') ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.subject.trim().length < 5) errs.subject = t('errors.minLength', { n: 5 });
    if (form.message.trim().length < 10) errs.message = t('errors.minLength', { n: 10 });
    const order = form.orderNumber.trim().toUpperCase();
    if (order && !ORDER_NO.test(order)) errs.orderNumber = t('help.orderNumberHint');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ number: string }>('/support/tickets', { method: 'POST', body: { subject: form.subject.trim(), category: form.category, message: form.message.trim(), ...(order ? { orderNumber: order } : {}) } });
      toast({ tone: 'success', message: t('help.sent', { number: r.number }) });
      router.replace(paths.ticket(l, r.number));
    } catch (err) { setError(errorMessage(err, t)); setBusy(false); }
  }

  return (
    <div className="card mx-auto max-w-2xl p-6">
      <h1 className="mb-5 text-xl font-bold">{t('help.newTicket')}</h1>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('help.category')}>
            {(a) => <select {...a} value={form.category} onChange={set('category')} className="input">{CATEGORIES.map((c) => <option key={c} value={c}>{t(`help.topics.${c}`)}</option>)}</select>}
          </Field>
          <Field label={<>{t('help.orderNumber')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></>} error={errors.orderNumber}>
            {(a) => <input {...a} value={form.orderNumber} onChange={set('orderNumber')} className="input uppercase" dir="ltr" placeholder="FMX-QA-…" maxLength={24} />}
          </Field>
        </div>
        <Field label={t('help.subject')} error={errors.subject}>
          {(a) => <input {...a} value={form.subject} onChange={set('subject')} className="input" maxLength={150} />}
        </Field>
        <Field label={t('help.message')} error={errors.message}>
          {(a) => <textarea {...a} value={form.message} onChange={set('message')} rows={6} maxLength={4000} className="input" />}
        </Field>
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto" data-testid="ticket-submit">{busy && <Spinner className="size-4" />}{t('help.send')}</button>
      </form>
    </div>
  );
}

export function TicketThread({ number }: { number: string }) {
  const t = useT();
  const l = t.locale;
  const toast = useToast();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setTicket(await api<TicketDetail>(`/support/tickets/${encodeURIComponent(number)}`)); }
    catch (e) { if (isNotFound(e)) setMissing(true); }
  }, [number]);
  useEffect(() => { void load(); }, [load]);

  if (missing) return <EmptyState title={t('errors.notFoundTitle')} action={<Link href={paths.tickets(l)} className="btn-primary">{t('help.myTickets')}</Link>} />;
  if (!ticket) return <div className="skeleton h-60" />;
  const closed = ticket.status === 'CLOSED';

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try { await api(`/support/tickets/${encodeURIComponent(number)}/messages`, { method: 'POST', body: { message: reply.trim() } }); setReply(''); await load(); }
    catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(false); }
  }
  async function close() {
    try { await api(`/support/tickets/${encodeURIComponent(number)}/close`, { method: 'POST' }); await load(); }
    catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{ticket.subject}</h1>
          <p className="text-sm text-ink-500"><span dir="ltr">{ticket.number}</span>{ticket.order && <> · <Link href={paths.order(l, ticket.order.orderNumber)} className="link" dir="ltr">{ticket.order.orderNumber}</Link></>}</p>
        </div>
        <StatusPill status={ticket.status} />
      </div>
      <ol className="space-y-3">
        {ticket.messages.map((m, i) => (
          <li key={i} className={`flex ${m.fromYou ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.fromYou ? 'bg-brand-600 text-white' : 'border border-ink-100 bg-white text-ink-800'}`}>
              <p className={`mb-1 text-xs font-semibold ${m.fromYou ? 'text-white/80' : 'text-brand-700'}`}>{m.fromYou ? t('help.you') : t('help.team')}</p>
              <p className="whitespace-pre-line leading-6">{m.body}</p>
              <p className={`mt-1.5 text-[11px] ${m.fromYou ? 'text-white/70' : 'text-ink-400'}`}>{formatDateTime(m.createdAt, l)}</p>
            </div>
          </li>
        ))}
      </ol>
      {closed ? <p className="mt-6 rounded-xl bg-ink-50 p-4 text-sm text-ink-600">{t('help.closedNote')}</p> : (
        <form onSubmit={send} className="mt-6 space-y-3">
          <label htmlFor="reply" className="sr-only">{t('help.reply')}</label>
          <textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={4000} placeholder={t('help.replyPlaceholder')} className="input" />
          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={close} className="btn-ghost text-sm">{t('help.close')}</button>
            <button type="submit" disabled={busy || !reply.trim()} className="btn-primary">{busy ? <Spinner className="size-4" /> : <Send className="size-4 rtl:-scale-x-100" aria-hidden />}{t('help.reply')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
