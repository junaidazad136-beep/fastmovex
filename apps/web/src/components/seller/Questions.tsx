'use client';

import { MessageCircleQuestion } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';
import { Empty, ListSkeleton, MoreButton, Tabs, useDate } from './kit';
import { useSeller } from './SellerShell';

type Status = 'PENDING' | 'ANSWERED' | 'REJECTED';
interface SellerQuestion {
  id: string; body: string; locale: string; status: Status; answer: string | null; answeredAt: string | null; createdAt: string; askedBy: string;
  product: { id: string; slug: string; title: string; titleAr: string | null; imageUrl: string | null };
}
const TABS = ['PENDING', 'ANSWERED', 'REJECTED'] as const;

/**
 * Customers' questions about the store's products. The seller answers here; the answer shows on the product page
 * and the customer is told. "Don't publish" hides a question that is not about the product (spam, rude, a phone number).
 */
export function SellerQuestions() {
  const t = useT();
  const toast = useToast();
  const date = useDate();
  const { summary, reloadSummary } = useSeller();
  const [tab, setTab] = useState<Status>('PENDING');
  const [items, setItems] = useState<SellerQuestion[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (more?: string) => {
    setBusy(true);
    try {
      const r = await api<{ items: SellerQuestion[]; nextCursor: string | null }>(`/seller/questions?${new URLSearchParams({ status: tab, ...(more && { cursor: more }) })}`);
      setItems((x) => (more && x ? [...x, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(false); }
  }, [tab, toast, t]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const done = (id: string) => { setItems((x) => x?.filter((q) => q.id !== id) ?? null); void reloadSummary(); };

  return (
    <div className="space-y-5" data-testid="seller-questions">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.questions.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('seller.questions.lead')}</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label={(k) => t(`seller.questions.tabs.${k}`)} counts={{ PENDING: summary?.todo?.questions }} />
      {!items ? <ListSkeleton /> : items.length === 0 ? (
        <Empty icon={<MessageCircleQuestion className="size-6" aria-hidden />} title={t(`seller.questions.empty.${tab}`)} />
      ) : (
        <ul className="space-y-3">
          {items.map((q) => <QuestionCard key={q.id} q={q} date={date} onDone={done} />)}
        </ul>
      )}
      <MoreButton cursor={cursor} busy={busy} onMore={() => load(cursor!)} />
    </div>
  );
}

function QuestionCard({ q, date, onDone }: { q: SellerQuestion; date: (d: string) => string; onDone: (id: string) => void }) {
  const t = useT();
  const toast = useToast();
  const [answer, setAnswer] = useState(q.answer ?? '');
  const [editing, setEditing] = useState(q.status === 'PENDING');
  const [busy, setBusy] = useState<'' | 'answer' | 'reject'>('');

  async function send() {
    setBusy('answer');
    try {
      await api(`/seller/questions/${q.id}/answer`, { method: 'POST', body: { answer: answer.trim() } });
      haptic('success');
      toast({ tone: 'success', message: t('seller.questions.answered') });
      if (q.status === 'PENDING') onDone(q.id); else setEditing(false);
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(''); }
  }
  async function reject() {
    setBusy('reject');
    try {
      await api(`/seller/questions/${q.id}/reject`, { method: 'POST', body: {} });
      toast({ tone: 'success', message: t('seller.questions.rejected') });
      onDone(q.id);
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(''); }
  }

  return (
    <li className="card p-4" data-testid="seller-question">
      <Link href={paths.product(t.locale, q.product.slug)} className="flex items-center gap-3 hover:text-brand-700">
        <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-ink-50">{q.product.imageUrl && <Image src={q.product.imageUrl} alt="" fill sizes="44px" className="object-contain p-0.5" />}</span>
        <span className="line-clamp-2 text-sm font-medium">{pick(t.locale, q.product.title, q.product.titleAr)}</span>
      </Link>
      <p className="mt-3 text-[15px] font-semibold text-ink-900" dir="auto">{q.body}</p>
      <p className="mt-0.5 text-xs text-ink-500">{t('seller.questions.askedBy', { name: q.askedBy, date: date(q.createdAt) })}{q.locale === 'ar' ? ` · ${t('seller.questions.inArabic')}` : ''}</p>
      {editing ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`ans-${q.id}`} className="label">{t('seller.questions.yourAnswer')}</label>
          <textarea id={`ans-${q.id}`} className="input min-h-20" dir="auto" maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t('seller.questions.placeholder')} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={answer.trim().length < 2 || !!busy} onClick={send} data-testid="question-answer">{busy === 'answer' && <Spinner className="size-4" />}{t('seller.questions.send')}</button>
            {q.status === 'PENDING' ? (
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={reject} data-testid="question-reject">{busy === 'reject' && <Spinner className="size-4" />}{t('seller.questions.reject')}</button>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => { setAnswer(q.answer ?? ''); setEditing(false); }}>{t('common.cancel')}</button>
            )}
          </div>
          {q.status === 'PENDING' && <p className="hint">{t('seller.questions.rejectHint')}</p>}
        </div>
      ) : q.answer ? (
        <div className="mt-3 rounded-xl bg-ink-50 p-3 text-sm">
          <p className="whitespace-pre-line text-ink-800" dir="auto">{answer || q.answer}</p>
          <button type="button" className="link mt-2 text-xs" onClick={() => setEditing(true)}>{t('seller.questions.edit')}</button>
        </div>
      ) : null}
    </li>
  );
}
