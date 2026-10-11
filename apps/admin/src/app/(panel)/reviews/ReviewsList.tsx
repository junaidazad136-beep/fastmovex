'use client';

import { Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { summaryStale } from '@/components/layout/Shell';
import { Card, EmptyState, ErrorState, LoadMore, PageHeader, Tabs } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import { qs, useAction, useCursorList, useUrlState } from '@/lib/use-api';

interface Review {
  id: string;
  rating: number;
  body: string | null;
  images: string[];
  status: string;
  isVerifiedPurchase: boolean;
  createdAt: string;
  user: { id: string; fullName: string };
  product: { title: string; slug: string } | null;
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`size-4 ${i <= n ? 'fill-sand-400 text-sand-500' : 'text-ink-200'}`} aria-hidden />)}
    </span>
  );
}

/** New reviews are hidden until approved here; ratings are recalculated from approved reviews only. */
export function ReviewsList() {
  const [f, setF, ready] = useUrlState({ status: 'PENDING' });
  const list = useCursorList<Review>(ready ? `/admin/reviews${qs({ status: f.status })}` : null);
  const { busy, run } = useAction();

  async function removePhoto(r: Review, index: number) {
    const res = await run(`${r.id}-photo-${index}`, () => api<{ images: string[] }>(`/admin/reviews/${r.id}/images/${index}/remove`, { method: 'POST' }), 'Photo removed');
    if (res) list.setItems((items) => items?.map((x) => (x.id === r.id ? { ...x, images: res.images } : x)));
  }

  async function moderate(r: Review, status: 'APPROVED' | 'REJECTED') {
    const ok = await run(`${r.id}-${status}`, () => api(`/admin/reviews/${r.id}/moderate`, { method: 'POST', body: { status } }), status === 'APPROVED' ? 'Review published' : 'Review hidden');
    if (ok !== undefined) {
      list.setItems((items) => items?.filter((x) => x.id !== r.id));
      summaryStale();
    }
  }

  return (
    <>
      <PageHeader title="Reviews" description="Publish genuine reviews, hide abuse, spam and personal details. Remove single photos that show faces, addresses or unrelated pictures, then publish the rest." />
      <Card bodyClassName="p-0">
        <Tabs value={f.status} onChange={(status) => setF({ status })} tabs={[{ value: 'PENDING', label: 'To moderate' }, { value: 'APPROVED', label: 'Published' }, { value: 'REJECTED', label: 'Hidden' }]} />
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
        {!list.items && !list.error ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20" />)}</div> : null}
        <ul className="divide-y divide-ink-100">
          {list.items?.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars n={r.rating} />
                  <span className="text-sm font-medium">{r.user.fullName}</span>
                  {r.isVerifiedPurchase ? <span className="text-xs text-success-700">Verified purchase</span> : null}
                  <span className="text-xs text-ink-400">{formatDateTime(r.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">{r.product ? <>on <Link href={`/products?q=${encodeURIComponent(r.product.title)}`} className="link">{r.product.title}</Link></> : 'Store review'}</p>
                {r.body ? <p className="mt-2 text-sm whitespace-pre-line text-ink-800">{r.body}</p> : <p className="mt-2 text-sm text-ink-400 italic">No text</p>}
                {r.images.length ? (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {r.images.map((src, i) => (
                      <div key={src} className="relative">
                        <a href={src} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={`Photo ${i + 1} from the review`} className="size-24 rounded-md border border-ink-100 object-cover" />
                        </a>
                        <button type="button" onClick={() => removePhoto(r, i)} disabled={!!busy} title="Remove this photo (faces, addresses, unrelated pictures)" aria-label={`Remove photo ${i + 1}`}
                          className="absolute -end-2 -top-2 flex size-7 items-center justify-center rounded-full border border-ink-200 bg-white text-danger-600 shadow-sm hover:bg-danger-50" data-testid="remove-review-photo">
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-start gap-2">
                {r.status !== 'REJECTED' ? <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => moderate(r, 'REJECTED')}>Hide</button> : null}
                {r.status !== 'APPROVED' ? <button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => moderate(r, 'APPROVED')}>Publish</button> : null}
              </div>
            </li>
          ))}
        </ul>
        {list.items?.length === 0 ? <EmptyState title={f.status === 'PENDING' ? 'No reviews waiting' : 'Nothing here'} /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>
    </>
  );
}
