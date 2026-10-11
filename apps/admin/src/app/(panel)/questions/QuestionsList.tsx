'use client';

import { ExternalLink, Package } from 'lucide-react';
import { useState } from 'react';
import { useConfig } from '@/components/layout/Providers';
import { summaryStale } from '@/components/layout/Shell';
import { Badge, Card, EmptyState, ErrorState, LoadMore, PageHeader, Spinner, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime, timeAgo } from '@/lib/format';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

type Status = 'PENDING' | 'ANSWERED' | 'REJECTED';
interface Question {
  id: string;
  body: string;
  locale: string;
  status: Status;
  answer: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  rejectReason: string | null;
  createdAt: string;
  askedBy: string;
  product: { id: string; slug: string; title: string; titleAr: string | null; store: string; imageUrl: string | null };
}

/** Customers' questions about products: answer once, it shows on the product page and the customer is told. */
export function QuestionsList() {
  const [f, setF, ready] = useUrlState({ status: 'PENDING' });
  const list = useCursorList<Question>(ready ? `/admin/questions${qs({ status: f.status })}` : null);

  return (
    <>
      <PageHeader title="Product questions" description="Answers appear on the product page for everyone, and the customer gets an email (and WhatsApp if they turned it on). Questions are never shown before they are answered." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status as Status} onChange={(status) => setF({ status })} tabs={[{ value: 'PENDING', label: 'To answer' }, { value: 'ANSWERED', label: 'Answered' }, { value: 'REJECTED', label: 'Not published' }]} />
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        {!list.items && !list.error ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24" />)}</div> : null}
        <ul className="divide-y divide-ink-100">
          {list.items?.map((q) => (
            <QuestionRow key={q.id} q={q} onDone={(next) => {
              list.setItems((items) => (next && next.status === f.status ? items?.map((x) => (x.id === q.id ? next : x)) : items?.filter((x) => x.id !== q.id)));
              summaryStale();
            }} />
          ))}
        </ul>
        {list.items?.length === 0 ? <EmptyState title={f.status === 'PENDING' ? 'No questions waiting' : 'Nothing here'} description={f.status === 'PENDING' ? 'New questions from product pages appear here.' : undefined} /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
    </>
  );
}

function QuestionRow({ q, onDone }: { q: Question; onDone: (next: Question | null) => void }) {
  const { storefrontUrl } = useConfig();
  const { busy, run } = useAction();
  const [answer, setAnswer] = useState(q.answer ?? '');
  const [editing, setEditing] = useState(q.status === 'PENDING');
  const productUrl = `${storefrontUrl}/${q.locale === 'ar' ? 'ar' : 'en'}/p/${q.product.slug}#questions`;

  async function publish() {
    const first = q.status !== 'ANSWERED';
    const ok = await run('answer', () => api(`/admin/questions/${q.id}/answer`, { method: first ? 'POST' : 'PATCH', body: { answer: answer.trim() } }), first ? 'Answer published — the customer has been told.' : 'Answer updated.');
    if (ok !== undefined) {
      setEditing(false);
      onDone(first ? null : { ...q, answer: answer.trim() });
    }
  }
  async function reject() {
    const ok = await run('reject', () => api(`/admin/questions/${q.id}/reject`, { method: 'POST', body: {} }), 'Question will not be published.');
    if (ok !== undefined) onDone(null);
  }

  return (
    <li className="grid gap-4 px-5 py-4 lg:grid-cols-[260px_1fr]" data-testid="question-row">
      <a href={productUrl} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 text-sm hover:text-brand-700">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {q.product.imageUrl ? <img src={q.product.imageUrl} alt="" className="size-full object-cover" /> : <Package className="size-5 text-ink-400" aria-hidden />}
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 font-medium">{q.product.title}</span>
          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500">View on store <ExternalLink className="size-3" aria-hidden /></span>
        </span>
      </a>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <span className="font-medium text-ink-700">{q.askedBy}</span>
          <span title={formatDateTime(q.createdAt)}>{timeAgo(q.createdAt)}</span>
          {q.locale === 'ar' ? <Badge tone="gray">Arabic</Badge> : null}
          {q.status === 'ANSWERED' && q.answeredBy ? <span>· answered by {q.answeredBy}</span> : null}
        </div>
        <p className="mt-1 text-[15px] font-medium text-ink-900" dir="auto">{q.body}</p>
        {editing ? (
          <div className="mt-3 space-y-2">
            <label className="sr-only" htmlFor={`a-${q.id}`}>Answer</label>
            <textarea id={`a-${q.id}`} className="input min-h-24" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={2000} dir="auto"
              placeholder={q.locale === 'ar' ? 'Answer in Arabic — the customer asked in Arabic' : 'Write the answer customers will see on the product page'} data-testid="answer-input" />
            <div className="flex flex-wrap justify-end gap-2">
              {q.status === 'PENDING' ? <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={reject} data-testid="reject-question">{busy === 'reject' ? <Spinner /> : null} Don’t publish</button> : null}
              {q.status === 'ANSWERED' ? <button type="button" className="btn-ghost btn-sm" onClick={() => { setAnswer(q.answer ?? ''); setEditing(false); }}>Cancel</button> : null}
              <button type="button" className="btn-primary btn-sm" disabled={!!busy || answer.trim().length < 2} onClick={publish} data-testid="publish-answer">{busy === 'answer' ? <Spinner /> : null} {q.status === 'ANSWERED' ? 'Save answer' : 'Publish answer'}</button>
            </div>
          </div>
        ) : q.answer ? (
          <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-800">
            <p className="whitespace-pre-line" dir="auto">{q.answer}</p>
            <button type="button" className="link mt-1 text-xs" onClick={() => setEditing(true)}>Edit answer</button>
          </div>
        ) : null}
        {q.status === 'REJECTED' ? <p className="mt-2 text-xs text-ink-500">Not published{q.rejectReason ? `: ${q.rejectReason}` : ''}</p> : null}
        {q.status === 'ANSWERED' && !editing ? (
          <div className="mt-2 flex justify-end"><button type="button" className="btn-ghost btn-sm text-danger-600" disabled={!!busy} onClick={reject}>Take down</button></div>
        ) : null}
      </div>
    </li>
  );
}
