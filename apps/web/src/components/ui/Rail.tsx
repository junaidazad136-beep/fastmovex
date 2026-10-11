'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Horizontal, swipeable row (scroll-snap). Arrow buttons appear on larger screens when there is more to see. */
export function Rail({ children, label, prevLabel, nextLabel }: { children: ReactNode; label: string; prevLabel: string; nextLabel: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft); // negative in RTL
    setEdges({ start: pos <= 4, end: pos >= max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [measure]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <ul ref={ref} aria-label={label} className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pb-1 sm:-mx-6 sm:gap-3 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:px-0">
        {children}
      </ul>
      {!edges.start && (
        <button type="button" onClick={() => scroll(-1)} aria-label={prevLabel} className="absolute -start-4 top-1/3 z-10 hidden size-10 items-center justify-center rounded-full bg-white shadow-[var(--shadow-pop)] ring-1 ring-ink-100 hover:bg-ink-50 lg:flex">
          <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden />
        </button>
      )}
      {!edges.end && (
        <button type="button" onClick={() => scroll(1)} aria-label={nextLabel} className="absolute -end-4 top-1/3 z-10 hidden size-10 items-center justify-center rounded-full bg-white shadow-[var(--shadow-pop)] ring-1 ring-ink-100 hover:bg-ink-50 lg:flex">
          <ChevronRight className="size-5 rtl:rotate-180" aria-hidden />
        </button>
      )}
    </div>
  );
}
