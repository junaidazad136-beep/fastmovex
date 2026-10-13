'use client';

import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';

export interface HeroSlide {
  id: string;
  imageUrl: string;
  link: { href: string; external: boolean } | null;
  kicker: string | null;
  headline: string | null;
  subline: string | null;
  cta: string | null;
}

/** "Up to *50% off*" → the starred words in the purple gradient. */
function Accented({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*]+\*)/).map((part, i) =>
        part.length > 2 && part.startsWith('*') && part.endsWith('*') ? (
          <span key={i} className="bg-gradient-to-r from-[#C13CFE] to-[#8F3CF7] bg-clip-text text-transparent">{part.slice(1, -1)}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function SlideBody({ s, eager }: { s: HeroSlide; eager: boolean }) {
  if (!s.headline) {
    return (
      <div className="relative aspect-[790/310] md:aspect-[1280/400]">
        <Image src={s.imageUrl} alt="" fill priority={eager} sizes="(min-width: 1320px) 1280px, 94vw" className="object-cover" quality={80} />
      </div>
    );
  }
  return (
    <div className="relative aspect-[790/310] overflow-hidden bg-[linear-gradient(110deg,#0B0713_0%,#1E0B45_55%,#3A0F8F_100%)] md:aspect-[1280/400]">
      <div aria-hidden className="absolute -end-10 -top-16 size-64 rounded-full bg-[#7422E6]/40 blur-3xl md:size-96" />
      <div className="absolute inset-y-0 end-0 w-[46%]">
        <Image src={s.imageUrl} alt="" fill priority={eager} sizes="(min-width: 1320px) 640px, 48vw" className="object-contain p-2 md:p-6" quality={80} />
      </div>
      <div className="relative flex h-full max-w-[64%] flex-col justify-center gap-1.5 ps-4 text-white md:max-w-[56%] md:gap-3 md:ps-12">
        {s.kicker ? <span className="w-fit rounded-md bg-[#7422E6] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide md:text-xs">{s.kicker}</span> : null}
        <p className="text-[22px] font-black uppercase leading-[1.05] tracking-tight md:text-5xl">
          {s.headline.split('\n').map((line, i) => <span key={i} className="block"><Accented text={line} /></span>)}
        </p>
        {s.subline ? <p className="line-clamp-1 text-[12px] text-white/85 md:text-base">{s.subline}</p> : null}
        {s.cta && s.link ? (
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#7422E6] px-3.5 py-1.5 text-[12px] font-semibold shadow-lg shadow-[#7422E6]/30 md:px-6 md:py-2.5 md:text-base">
            {s.cta} <ArrowRight className="size-3.5 rtl:rotate-180 md:size-4" aria-hidden />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Home slider: one banner at a time with the next one peeking on phones, dots under it, moves on by itself every 5 s. */
export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const t = useT();
  const label = t('home.promo');
  const slideLabel = (n: number, total: number) => t('home.slide', { n, total });
  const ref = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  const goTo = useCallback((i: number) => {
    const el = ref.current;
    const item = el?.children[i] as HTMLElement | undefined;
    if (!el || !item) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const first = el.children[0] as HTMLElement;
    // RTL rows scroll to negative positions (Chrome, Safari, Firefox)
    const left = rtl ? item.offsetLeft + item.offsetWidth - (first.offsetLeft + first.offsetWidth) : item.offsetLeft - first.offsetLeft;
    el.scrollTo({ left, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) setActive(Number((e.target as HTMLElement).dataset.i));
    }, { root: el, threshold: [0.6] });
    Array.from(el.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => {
      if (!paused.current && document.visibilityState === 'visible') goTo((active + 1) % slides.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [active, slides.length, goTo]);

  return (
    <section aria-label={label} aria-roledescription="carousel" className="container-page pt-3 sm:pt-5">
      <ul
        ref={ref}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-px-4 px-4 sm:mx-0 sm:px-0"
        onPointerEnter={() => { paused.current = true; }}
        onPointerLeave={() => { paused.current = false; }}
        onTouchStart={() => { paused.current = true; }}
        onFocus={() => { paused.current = true; }}
      >
        {slides.map((s, i) => {
          const body = <SlideBody s={s} eager={i === 0} />;
          const cls = 'block overflow-hidden rounded-2xl bg-ink-100';
          return (
            <li key={s.id} data-i={i} aria-roledescription="slide" aria-label={slideLabel(i + 1, slides.length)} className={`relative shrink-0 snap-start ${slides.length > 1 ? 'w-[94%] md:w-full' : 'w-full'}`}>
              {s.link ? (
                // a picture-only banner has no text of its own: the link is named after the slide
                s.link.external
                  ? <a href={s.link.href} className={cls} rel="noopener noreferrer" aria-label={s.headline ? undefined : slideLabel(i + 1, slides.length)}>{body}</a>
                  : <Link href={s.link.href} className={cls} aria-label={s.headline ? undefined : slideLabel(i + 1, slides.length)}>{body}</Link>
              ) : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ul>
      {slides.length > 1 ? (
        <div className="mt-2.5 flex justify-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={slideLabel(i + 1, slides.length)}
              aria-current={i === active ? 'true' : undefined}
              className={`h-2 rounded-full transition-all ${i === active ? 'w-5 bg-brand-600' : 'w-2 bg-ink-200 hover:bg-ink-300'}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
