'use client';

import { MessageSquareText, Star } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { Empty, ListSkeleton, MoreButton, useDate } from './kit';

interface SellerReview {
  id: string; target: 'PRODUCT' | 'SELLER'; rating: number; body: string | null; createdAt: string; author: string; images: string[];
  product: { title: string; titleAr: string | null; slug: string } | null;
}
interface Page { items: SellerReview[]; nextCursor: string | null; summary?: { count: number; average: number; byStar: number[] } }

/** What customers say about the store and its products: the average, how the stars spread, and every review. */
export function SellerReviews() {
  const t = useT();
  const toast = useToast();
  const date = useDate();
  const [rating, setRating] = useState<number | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [summary, setSummary] = useState<Page['summary'] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ ...(rating && { rating: String(rating) }), ...(cursor && { cursor }) });
      const r = await api<Page>(`/seller/reviews?${qs}`);
      if (r.summary && !rating) setSummary(r.summary);
      setPage((p) => (cursor && p ? { ...r, items: [...p.items, ...r.items] } : r));
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(false); }
  }, [rating, toast, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5" data-testid="seller-reviews">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('seller.reviews.title')}</h1>
      {summary && summary.count > 0 && (
        <section className="card grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="text-center sm:pe-6">
            <p className="tabular text-4xl font-extrabold" data-testid="reviews-average">{summary.average.toFixed(1)}</p>
            <span className="stars mt-1" style={{ '--rating': `${(summary.average / 5) * 100}%` } as React.CSSProperties} aria-hidden />
            <p className="mt-1 text-sm text-ink-500">{t.plural('seller.reviews.count', summary.count)}</p>
          </div>
          <ul className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((n) => {
              const c = summary.byStar[n - 1];
              const pct = summary.count ? Math.round((c / summary.count) * 100) : 0;
              return (
                <li key={n}>
                  <button type="button" onClick={() => setRating(rating === n ? null : n)} aria-pressed={rating === n} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1 text-sm ${rating === n ? 'bg-brand-50' : 'hover:bg-ink-50'}`} data-testid={`stars-${n}`}>
                    <span className="flex w-10 shrink-0 items-center gap-1 font-medium">{n}<Star className="size-3.5 fill-sand-400 text-sand-400" aria-hidden /></span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"><span className="block h-full rounded-full bg-sand-400" style={{ width: `${pct}%` }} /></span>
                    <span className="tabular w-10 shrink-0 text-end text-ink-500">{c}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {rating && <p className="text-sm text-ink-600">{t('seller.reviews.filtered', { n: rating })} <button type="button" className="link" onClick={() => setRating(null)}>{t('seller.reviews.showAll')}</button></p>}
      {!page ? <ListSkeleton /> : page.items.length === 0 ? (
        <Empty icon={<MessageSquareText className="size-6" aria-hidden />} title={t('seller.reviews.empty')} text={t('seller.reviews.emptyHint')} />
      ) : (
        <ul className="space-y-3">
          {page.items.map((r) => (
            <li key={r.id} className="card p-4" data-testid="seller-review">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="stars" style={{ '--rating': `${r.rating * 20}%` } as React.CSSProperties} aria-label={t('product.ratingOutOf', { rating: r.rating })} />
                <span className="text-xs text-ink-500">{r.author} · {date(r.createdAt)}</span>
              </div>
              <p className="mt-1.5 text-xs font-medium text-ink-500">
                {r.product ? <Link href={paths.product(t.locale, r.product.slug)} className="hover:text-brand-700">{pick(t.locale, r.product.title, r.product.titleAr)}</Link> : t('seller.reviews.aboutStore')}
              </p>
              {r.body && <p className="mt-2 whitespace-pre-line text-sm text-ink-800">{r.body}</p>}
              {r.images.length > 0 && (
                <div className="mt-3 flex gap-2">
                  {r.images.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="relative size-16 overflow-hidden rounded-lg bg-ink-50"><Image src={u} alt="" fill sizes="64px" className="object-cover" /></a>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {page && <MoreButton cursor={page.nextCursor} busy={busy} onMore={() => load(page.nextCursor!)} />}
      <p className="text-xs text-ink-500">{t('seller.reviews.note')}</p>
    </div>
  );
}
