'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Wraps a sideways-scrolling row and draws a short line under it (phones): the purple part shows where you are and
 * how much is left. Hidden when everything already fits.
 */
export function ScrollTrack({ children, className = '' }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ size: 1, start: 0 });
  useEffect(() => {
    const el = box.current?.querySelector('ul');
    if (!el) return;
    const measure = () => {
      const size = el.scrollWidth ? el.clientWidth / el.scrollWidth : 1;
      setPos({ size, start: el.scrollWidth ? Math.abs(el.scrollLeft) / el.scrollWidth : 0 }); // RTL scrollLeft is negative
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, []);
  return (
    <div ref={box} className={className}>
      {children}
      {pos.size < 0.98 ? (
        <div aria-hidden className="relative mx-auto mt-2 h-1 w-11 overflow-hidden rounded-full bg-ink-100 md:hidden" data-testid="scroll-track">
          <div className="absolute inset-y-0 rounded-full bg-brand-600" style={{ width: `${Math.max(pos.size, 0.12) * 100}%`, insetInlineStart: `${Math.min(pos.start, 1 - Math.max(pos.size, 0.12)) * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}
