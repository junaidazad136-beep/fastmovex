'use client';

import { ImagePlus, Star, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { MyQuestion, MyReview, Reviewable } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { shrinkPhoto } from '@/lib/image';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { FormError } from '../auth/fields';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { Stars } from '../ui/Stars';

function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('reviews.rating')} className="flex gap-1" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t.plural('reviews.stars', n)} onClick={() => onChange(n)} className="rounded p-0.5" data-testid={`star-${n}`}>
          <Star className={`size-8 ${n <= value ? 'fill-sand-500 text-sand-500' : 'text-ink-300'}`} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ item, onDone }: { item: Reviewable; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [storeRating, setStoreRating] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []); // previews freed when the form closes

  function pickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
    const added = chosen.slice(0, 5 - photos.length).map((file) => ({ file, url: URL.createObjectURL(file) }));
    urls.current.push(...added.map((a) => a.url));
    setPhotos([...photos, ...added]);
    e.target.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) { setError(t('reviews.rating')); return; }
    setBusy(true); setError('');
    try {
      const review = await api<{ id: string }>('/reviews', { method: 'POST', body: { orderItemId: item.orderItemId, target: 'PRODUCT', rating, body: body.trim() || undefined } });
      let failed = false;
      for (const p of photos) { // one at a time: the server keeps them in order
        const form = new FormData();
        form.append('file', await shrinkPhoto(p.file), p.file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg');
        await api(`/reviews/${review.id}/images`, { method: 'POST', body: form }).catch(() => { failed = true; });
      }
      if (failed) toast({ tone: 'error', message: t('reviews.photoFailed') });
      if (storeRating) await api('/reviews', { method: 'POST', body: { orderItemId: item.orderItemId, target: 'SELLER', rating: storeRating } }).catch(() => {});
      toast({ tone: 'success', message: t('reviews.thanks') });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? t('reviews.already') : errorMessage(err, t));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={error} />
      <div><p className="label">{t('reviews.rating')}</p><StarInput value={rating} onChange={setRating} /></div>
      <label className="block"><span className="label">{t('reviews.body')}</span><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} placeholder={t('reviews.bodyPlaceholder')} className="input" /></label>
      <div>
        <p className="label">{t('reviews.photos')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></p>
        <ul className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <li key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="size-16 rounded-lg object-cover ring-1 ring-ink-100" />
              <button type="button" onClick={() => setPhotos(photos.filter((x) => x !== p))} aria-label={t('reviews.removePhoto', { n: i + 1 })} className="absolute -end-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-ink-900 text-white shadow"><X className="size-3.5" aria-hidden /></button>
            </li>
          ))}
          {photos.length < 5 && (
            <li>
              <label className="flex size-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-ink-300 text-[11px] text-ink-500 hover:border-brand-500 hover:text-brand-700 focus-within:ring-2 focus-within:ring-brand-600">
                <ImagePlus className="size-5" aria-hidden />{t('reviews.addPhotos')}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={pickPhotos} className="sr-only" data-testid="review-photos-input" />
              </label>
            </li>
          )}
        </ul>
        <p className="hint mt-1.5">{t('reviews.photosHint')}</p>
      </div>
      <p className="hint">{t('reviews.moderation')}</p>
      <div><p className="label">{t('reviews.rateStore')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></p><StarInput value={storeRating} onChange={setStoreRating} /></div>
      <button type="submit" disabled={busy} className="btn-primary w-full" data-testid="review-submit">{busy && <Spinner className="size-4" />}{t('reviews.submit')}</button>
    </form>
  );
}

export function MyReviews() {
  const t = useT();
  const l = t.locale;
  const params = useSearchParams();
  const [pending, setPending] = useState<Reviewable[] | null>(null);
  const [mine, setMine] = useState<MyReview[]>([]);
  const [questions, setQuestions] = useState<MyQuestion[]>([]);
  const [active, setActive] = useState<Reviewable | null>(null);

  const load = async () => {
    const [p, m, q] = await Promise.all([api<Reviewable[]>('/me/reviewable'), api<MyReview[]>('/me/reviews'), api<MyQuestion[]>('/me/questions').catch(() => [])]);
    setPending(p); setMine(m); setQuestions(q);
    return p;
  };
  useEffect(() => {
    load().then((p) => { const want = params.get('item'); if (want) setActive(p.find((x) => x.orderItemId === want) ?? null); }).catch(() => setPending([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pending === null) return <div className="skeleton h-40" />;
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('reviews.toReview')}</h1>
        {pending.length === 0 ? <p className="text-sm text-ink-500">{t('reviews.none')}</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {pending.map((r) => (
              <li key={r.orderItemId} className="card flex items-center gap-3 p-3">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-ink-50">{r.imageUrl && <Image src={r.imageUrl} alt="" fill sizes="56px" className="object-contain p-1" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium">{r.title}</p>
                  <Link href={paths.order(l, r.orderNumber)} className="text-xs text-ink-500 hover:underline">{t('reviews.fromOrder', { number: r.orderNumber })}</Link>
                </div>
                <button type="button" onClick={() => setActive(r)} className="btn-secondary px-3 py-1.5 text-xs" data-testid="write-review">{t('reviews.write')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="section-title mb-3">{t('reviews.mine')}</h2>
        {mine.length === 0 ? <p className="text-sm text-ink-500">{t('reviews.noneWritten')}</p> : (
          <ul className="card divide-y divide-ink-100">
            {mine.map((r) => (
              <li key={r.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={r.rating} label={t('product.ratingOutOf', { rating: r.rating })} />
                  {r.product ? <Link href={paths.product(l, r.product.slug)} className="font-medium hover:text-brand-700">{r.product.title}</Link> : <span className="font-medium">{t('reviews.rateStore')}</span>}
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">{t(`reviews.status.${r.status}`)}</span>
                  <span className="text-xs text-ink-400">{formatDate(r.createdAt, l)}</span>
                </div>
                {r.body && <p className="mt-1.5 text-ink-600">{r.body}</p>}
                {r.images?.length > 0 && (
                  <ul className="mt-2 flex gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.images.map((src) => <li key={src}><img src={src} alt="" loading="lazy" className="size-12 rounded-md object-cover ring-1 ring-ink-100" /></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="section-title mb-3">{t('reviews.questions')}</h2>
        {questions.length === 0 ? <p className="text-sm text-ink-500">{t('reviews.noQuestions')}</p> : (
          <ul className="card divide-y divide-ink-100" data-testid="my-questions">
            {questions.map((q) => (
              <li key={q.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`${paths.product(l, q.product.slug)}#questions`} className="font-medium hover:text-brand-700">{pick(l, q.product.title, q.product.titleAr)}</Link>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${q.status === 'ANSWERED' ? 'bg-success-50 text-success-700' : 'bg-ink-100 text-ink-600'}`}>{t(`reviews.questionStatus.${q.status}`)}</span>
                  <span className="text-xs text-ink-400">{formatDate(q.createdAt, l)}</span>
                </div>
                <p className="mt-1.5 text-ink-800" dir="auto">{q.question}</p>
                {q.answer && <p className="mt-1.5 rounded-lg bg-ink-50 px-3 py-2 text-ink-700" dir="auto">{q.answer}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Dialog open={!!active} onClose={() => setActive(null)} title={active?.title ?? ''} closeLabel={t('common.close')}>
        {active && <ReviewForm item={active} onDone={() => { setActive(null); void load(); }} />}
      </Dialog>
    </div>
  );
}
