'use client';

import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
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

/** One banner: the picture alone, or (with a headline) the text drawn by the website beside the picture. Also used for the mid-page promo. */
export function SlideBody({ s, eager }: { s: HeroSlide; eager: boolean }) {
  if (!s.headline) {
    return (
      <div className="relative aspect-[790/310] md:aspect-[1280/400]">
        <Image src={s.imageUrl} alt="" fill priority={eager} sizes="(min-width: 1320px) 1280px, 94vw" className="object-cover" quality={80} />
      </div>
    );
  }
  return (
    <div className="relative aspect-[790/360] overflow-hidden bg-[linear-gradient(110deg,#0B0713_0%,#1E0B45_55%,#3A0F8F_100%)] md:aspect-[1280/400]">
      <div aria-hidden className="absolute -end-10 -top-16 size-64 rounded-full bg-[#7422E6]/40 blur-3xl md:size-96" />
      <div className="absolute inset-y-0 end-0 w-[46%]">
        <Image src={s.imageUrl} alt="" fill priority={eager} sizes="(min-width: 1320px) 640px, 48vw" className="object-contain p-2 md:p-6" quality={80} />
      </div>
      <div className="relative flex h-full max-w-[64%] flex-col justify-center gap-1 ps-4 text-white md:max-w-[56%] md:gap-3 md:ps-12">
        {s.kicker ? <span className="w-fit rounded-md bg-[#7422E6] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide md:text-xs">{s.kicker}</span> : null}
        <p className="text-[clamp(17px,6vw,22px)] font-black uppercase leading-[1.05] tracking-tight md:text-5xl">
          {s.headline.split('\n').map((line, i) => <span key={i} className="block"><Accented text={line} /></span>)}
        </p>
        {s.subline ? <p className="line-clamp-2 text-[11px] leading-snug text-white/85 md:line-clamp-1 md:text-base">{s.subline}</p> : null}
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
