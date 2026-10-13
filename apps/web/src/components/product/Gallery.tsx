'use client';

import { Share2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { WishlistButton } from './WishlistButton';

export interface GalleryImage { id: string; url: string; alt: string; variantId: string | null }

const ROUND_BTN = 'flex size-10 items-center justify-center rounded-full bg-white/95 text-ink-800 shadow-[0_1px_6px_rgb(0_0_0/0.12)] ring-1 ring-black/5 transition hover:text-brand-700';

/**
 * Phones: edge-to-edge photos you swipe, dots under them, share and save on the photo. Larger screens: thumbnails beside
 * the photo. Jumps to the selected colour's photo.
 */
export function Gallery({ images, activeVariantId, productId, title }: { images: GalleryImage[]; activeVariantId?: string | null; productId?: string; title?: string }) {
  const t = useT();
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const goTo = (i: number, smooth = true) => {
    setIndex(i);
    const el = track.current;
    const slide = el?.children[i] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - el.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    if (!activeVariantId) return;
    const i = images.findIndex((im) => im.variantId === activeVariantId);
    if (i >= 0) goTo(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVariantId]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w) setIndex(Math.round(Math.abs(el.scrollLeft) / w));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  async function share() {
    const url = window.location.href.split('#')[0];
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      toast({ tone: 'success', message: t('product.linkCopied') });
    } catch { /* closed the share sheet */ }
  }

  if (!images.length) return <div className="aspect-square bg-ink-50 md:rounded-2xl" />;

  return (
    <div className="flex flex-col-reverse gap-3 lg:flex-row" aria-label={t('product.gallery')} role="region">
      {images.length > 1 && (
        <ul className="no-scrollbar flex gap-2 overflow-x-auto max-md:hidden lg:max-h-[560px] lg:flex-col lg:overflow-y-auto">
          {images.map((im, i) => (
            <li key={im.id} className="shrink-0">
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-label={t('product.imageOf', { n: i + 1, total: images.length })}
                aria-current={i === index}
                className={`relative block size-16 overflow-hidden rounded-xl border-2 bg-ink-50 ${i === index ? 'border-brand-600' : 'border-transparent hover:border-ink-200'}`}
              >
                <Image src={im.url} alt="" fill sizes="64px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative flex-1">
        <div ref={track} tabIndex={0} aria-label={t('product.gallery')} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto bg-ink-50 focus-visible:outline-2 md:rounded-2xl" data-testid="gallery-track">
          {images.map((im, i) => (
            <div key={im.id} className="relative aspect-square w-full shrink-0 snap-center">
              <Image src={im.url} alt={im.alt} fill priority={i === 0} sizes="(min-width: 1024px) 560px, 100vw" className="object-contain p-2 md:p-4" quality={80} />
            </div>
          ))}
        </div>
        <div className="absolute end-3 top-3 flex flex-col gap-2">
          <button type="button" onClick={share} className={ROUND_BTN} aria-label={t('product.share')} title={t('product.share')} data-testid="share"><Share2 className="size-[18px]" aria-hidden /></button>
          {productId && <WishlistButton productId={productId} className={`${ROUND_BTN} md:hidden`} />}
        </div>
        {images.length > 1 && (
          <div className="flex justify-center gap-1.5 pt-2.5 md:hidden" data-testid="gallery-dots">
            {images.map((im, i) => (
              <button key={im.id} type="button" onClick={() => goTo(i)} aria-label={t('product.imageOf', { n: i + 1, total: images.length })} aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-brand-600' : 'w-1.5 bg-ink-300'}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
