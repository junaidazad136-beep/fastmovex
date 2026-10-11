'use client';

import { MessageCircleQuestion, Store } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { ProductQuestion, QuestionPage } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { paths, pick } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';

/** Answered questions about the product, and a form to ask the store (signed-in customers). */
export function Questions({ slug, initial }: { slug: string; initial: QuestionPage }) {
  const t = useT();
  const pathname = usePathname();
  const { user } = useSession();
  const [items, setItems] = useState<ProductQuestion[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  const total = initial.total ?? items.length;
  const endpoint = `/products/${encodeURIComponent(slug)}/questions`;

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api<QuestionPage>(`${endpoint}?cursor=${encodeURIComponent(cursor)}`, { auth: 'none' });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch { /* keep what is shown */ } finally { setLoading(false); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text.length < 10) { setError(t('errors.minLength', { n: 10 })); return; }
    setState('busy'); setError('');
    try {
      await api(endpoint, { method: 'POST', body: { body: text } });
      setState('sent'); setBody(''); setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('product.askTooMany') : errorMessage(err, t));
      setState('idle');
    }
  }

  return (
    <section aria-labelledby="questions-title" className="mt-12" id="questions" data-testid="questions">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="questions-title" className="section-title">{t('product.questions')}</h2>
          {total > 0 && <p className="mt-1 text-sm text-ink-500">{t.plural('product.questionsCount', total)}</p>}
        </div>
        {user ? (
          !open && state !== 'sent' && <button type="button" onClick={() => setOpen(true)} className="btn-secondary" data-testid="ask-open"><MessageCircleQuestion className="size-4" aria-hidden />{t('product.ask')}</button>
        ) : (
          <Link href={paths.login(t.locale, `${pathname}#questions`)} className="btn-secondary" data-testid="ask-signin"><MessageCircleQuestion className="size-4" aria-hidden />{t('product.askSignIn')}</Link>
        )}
      </div>

      {state === 'sent' && <p className="mb-4 rounded-xl bg-success-50 px-4 py-3 text-sm text-success-700" role="status" data-testid="ask-sent">{t('product.askThanks')}</p>}

      {open && (
        <form onSubmit={send} className="card mb-5 space-y-3 p-4" noValidate data-testid="ask-form">
          <label className="block">
            <span className="label">{t('product.askLabel')}</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={500} placeholder={t('product.askPlaceholder')} className="input" dir="auto" aria-invalid={!!error || undefined} aria-describedby="ask-hint" autoFocus />
          </label>
          <p id="ask-hint" className="hint">{t('product.askHint')}</p>
          {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOpen(false); setError(''); }} className="btn-ghost">{t('common.cancel')}</button>
            <button type="submit" disabled={state === 'busy'} className="btn-primary" data-testid="ask-send">{state === 'busy' && <Spinner className="size-4" />}{t('product.askSend')}</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-ink-200 bg-white p-5 text-sm text-ink-500">
          <MessageCircleQuestion className="size-5 shrink-0 text-ink-400" aria-hidden />
          {t('product.noQuestions')}
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
          {items.map((q) => (
            <li key={q.id} className="p-4" data-testid="question">
              <p className="font-semibold text-ink-900" dir="auto">{q.question}</p>
              <p className="mt-0.5 text-xs text-ink-400">{t('product.askedBy', { name: q.askedBy, date: formatDate(q.askedAt, t.locale) })}</p>
              <div className="mt-3 flex gap-2.5 rounded-xl bg-ink-50 p-3">
                <Store className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                <div>
                  <p className="text-xs font-semibold text-ink-600">{t('product.answerFrom', { store: pick(t.locale, q.answeredBy.name, q.answeredBy.nameAr) })}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-ink-800" dir="auto">{q.answer}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" onClick={more} disabled={loading} className="btn-secondary mt-4">{loading && <Spinner className="size-4" />}{t('product.moreQuestions')}</button>
      )}
    </section>
  );
}
