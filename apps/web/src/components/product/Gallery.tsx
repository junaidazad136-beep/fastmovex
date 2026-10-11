'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';

export interface GalleryImage { id: string; url: string; alt: string; variantId: string | null }

/** Swipeable on phones (scroll-snap), thumbnails on larger screens. Jumps to the selected variant's photo. */
export function Gallery({ images, activeVariantId }: { images: GalleryImage[]; activeVariantId?: string | null }) {
  const t = useT();
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

  if (!images.length) return <div className="aspect-square rounded-2xl bg-ink-50" />;

  return (
    <div className="flex flex-col-reverse gap-3 lg:flex-row" aria-label={t('product.gallery')} role="region">
      {images.length > 1 && (
        <ul className="no-scrollbar flex gap-2 overflow-x-auto lg:max-h-[560px] lg:flex-col lg:overflow-y-auto">
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
        <div ref={track} tabIndex={0} aria-label={t('product.gallery')} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-2xl bg-ink-50 focus-visible:outline-2">
          {images.map((im, i) => (
            <div key={im.id} className="relative aspect-square w-full shrink-0 snap-center">
              <Image src={im.url} alt={im.alt} fill priority={i === 0} sizes="(min-width: 1024px) 560px, 100vw" className="object-contain p-4" quality={80} />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <div className="tabular absolute bottom-3 end-3 rounded-full bg-ink-900/70 px-2.5 py-1 text-xs font-medium text-white lg:hidden" aria-hidden>
            {index + 1}/{images.length}
          </div>
        )}
      </div>
    </div>
  );
}
