'use client';

import { BadgeCheck, Camera, ChevronLeft, ChevronRight, MessageSquareText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { Review, ReviewPage } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { Stars } from '../ui/Stars';

/** Reviews come only from customers whose item was delivered (the API enforces it). */
export function Reviews({ initial, endpoint, title }: { initial: ReviewPage; endpoint: string; title: string }) {
  const t = useT();
  const [items, setItems] = useState<Review[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [rating, setRating] = useState<number | null>(null);
  const [withPhotos, setWithPhotos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<{ urls: string[]; index: number } | null>(null);
  const { ratingAvg, ratingCount, photoReviews = 0 } = initial.summary;
  const histogram = initial.histogram ?? [];
  const gallery = initial.photos ?? [];

  async function load(r: number | null, after: string | null, photos = withPhotos) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (r) qs.set('rating', String(r));
      if (photos) qs.set('withPhotos', '1');
      if (after) qs.set('cursor', after);
      const page = await api<ReviewPage>(`${endpoint}?${qs}`, { auth: 'none' });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch { /* keep what is shown */ } finally {
      setLoading(false);
    }
  }

  function filter(r: number | null) {
    setRating(r);
    void load(r, null);
  }

  function togglePhotos() {
    setWithPhotos(!withPhotos);
    void load(rating, null, !withPhotos);
  }

  return (
    <section aria-labelledby="reviews-title" className="mt-12" id="reviews">
      <h2 id="reviews-title" className="section-title mb-5">{title}</h2>
      {ratingCount === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-ink-200 bg-white p-5 text-sm text-ink-500">
          <MessageSquareText className="size-5 shrink-0 text-ink-400" aria-hidden />
          {t('product.noReviews')}
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-[260px_1fr]">
          {gallery.length > 0 && (
            <div className="md:col-span-2" data-testid="review-photos">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-800"><Camera className="size-4 text-ink-400" aria-hidden />{t('product.customerPhotos')}</h3>
              <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {gallery.map((ph, i) => (
                  <li key={ph.url} className="shrink-0">
                    <button type="button" onClick={() => setViewing({ urls: gallery.map((g) => g.url), index: i })} className="block overflow-hidden rounded-xl ring-1 ring-ink-100 transition hover:ring-brand-400" aria-label={t('product.photoFromReview', { rating: ph.rating })}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.url} alt="" loading="lazy" decoding="async" className="size-24 object-cover sm:size-28" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="flex items-end gap-2">
              <span className="tabular text-[28px] font-bold sm:text-4xl">{ratingAvg.toFixed(1)}</span>
              <span className="pb-1 text-sm text-ink-500">/ 5</span>
            </div>
            <Stars value={ratingAvg} size="size-5" label={t('product.ratingOutOf', { rating: ratingAvg })} />
            <p className="mt-1 text-sm text-ink-500">{t.plural('product.reviewsCount', ratingCount)}</p>
            <ul className="mt-4 space-y-1.5">
              {histogram.map((h) => {
                const pct = ratingCount ? Math.round((h.count / ratingCount) * 100) : 0;
                return (
                  <li key={h.rating}>
                    <button
                      type="button"
                      onClick={() => filter(rating === h.rating ? null : h.rating)}
                      disabled={h.count === 0}
                      aria-pressed={rating === h.rating}
                      aria-label={t('product.filterByRating', { n: h.rating })}
                      className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs disabled:opacity-50 ${rating === h.rating ? 'bg-brand-50' : 'hover:bg-ink-100'}`}
                    >
                      <span className="tabular w-3 text-ink-600">{h.rating}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"><span className="block h-full rounded-full bg-sand-500" style={{ width: `${pct}%` }} /></span>
                      <span className="tabular w-8 text-end text-ink-500">{h.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {photoReviews > 0 && (
              <button type="button" onClick={togglePhotos} aria-pressed={withPhotos} className={`chip mt-3 ${withPhotos ? 'chip-active' : ''}`} data-testid="reviews-with-photos">
                <Camera className="size-3.5" aria-hidden />{t('product.withPhotos', { count: photoReviews })}
              </button>
            )}
            {(rating || withPhotos) && <button type="button" onClick={() => { setWithPhotos(false); setRating(null); void load(null, null, false); }} className="link mt-2 block text-sm">{t('product.allReviews')}</button>}
          </div>
          <div>
            <ul className="divide-y divide-ink-100">
              {items.map((r) => (
                <li key={r.id} className="py-4 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars value={r.rating} label={t('product.ratingOutOf', { rating: r.rating })} />
                    <span className="text-sm font-semibold text-ink-800">{r.author}</span>
                    {r.isVerifiedPurchase && (
                      <span className="inline-flex items-center gap-1 text-xs text-success-600"><BadgeCheck className="size-3.5" aria-hidden />{t('product.verifiedPurchase')}</span>
                    )}
                    <span className="text-xs text-ink-400">{formatDate(r.createdAt, t.locale)}</span>
                  </div>
                  {r.body && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink-700">{r.body}</p>}
                  {r.images.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {r.images.map((src, i) => (
                        <li key={src}>
                          <button type="button" onClick={() => setViewing({ urls: r.images, index: i })} className="block overflow-hidden rounded-lg ring-1 ring-ink-100 hover:ring-brand-400" aria-label={t('product.photoOf', { n: i + 1, total: r.images.length })}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="" loading="lazy" decoding="async" className="size-20 object-cover" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {cursor && (
              <button type="button" onClick={() => load(rating, cursor)} disabled={loading} className="btn-secondary mt-4">
                {loading && <Spinner className="size-4" />} {t('common.loadMore')}
              </button>
            )}
          </div>
        </div>
      )}
      <PhotoViewer viewing={viewing} onChange={setViewing} />
    </section>
  );
}

/** Full-size customer photos, one at a time (arrow keys or buttons). */
function PhotoViewer({ viewing, onChange }: { viewing: { urls: string[]; index: number } | null; onChange: (v: { urls: string[]; index: number } | null) => void }) {
  const t = useT();
  const total = viewing?.urls.length ?? 0;
  const go = (d: number) => viewing && onChange({ ...viewing, index: (viewing.index + d + total) % total });
  useEffect(() => {
    if (!viewing) return;
    const rtl = document.documentElement.dir === 'rtl';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(rtl ? -1 : 1);
      if (e.key === 'ArrowLeft') go(rtl ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Dialog open={!!viewing} onClose={() => onChange(null)} title={viewing ? t('product.photoOf', { n: viewing.index + 1, total }) : ''} closeLabel={t('common.close')} wide>
      {viewing && (
        <div className="relative" data-testid="photo-viewer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewing.urls[viewing.index]} alt="" className="mx-auto max-h-[65vh] w-auto rounded-xl object-contain" />
          {total > 1 && (
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => go(-1)} className="btn-secondary px-3" aria-label={t('product.previous')}><ChevronLeft className="size-5 rtl:rotate-180" aria-hidden /></button>
              <button type="button" onClick={() => go(1)} className="btn-secondary px-3" aria-label={t('product.next')}><ChevronRight className="size-5 rtl:rotate-180" aria-hidden /></button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
