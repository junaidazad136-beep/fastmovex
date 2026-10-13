'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live countdown to a deal's end. Renders nothing until mounted, so server and browser clocks never disagree in the HTML. */
export function Countdown({ endsAt, className = '', pill = false }: { endsAt: string; className?: string; pill?: boolean }) {
  const t = useT();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (now === null) return <span className={`inline-block h-6 w-28 ${className}`} aria-hidden />;
  const left = new Date(endsAt).getTime() - now;
  if (left <= 0) return <span className={`text-sm font-semibold text-ink-500 ${className}`}>{t('deal.ended')}</span>;
  const p = parts(left);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (pill) {
    // "02 : 26 : 45" in a soft purple pill (days fold into hours up to 99)
    const hours = p.d * 24 + p.h;
    return (
      <span className={`tabular inline-flex items-center rounded-lg bg-brand-50 px-2 py-0.5 text-[12px] font-bold sm:px-2.5 sm:py-1 sm:text-[13px] tracking-wide text-brand-700 ${className}`} dir="ltr" role="timer" aria-live="off" data-testid="deal-countdown">
        {hours > 99 ? <><bdi>{p.d}{t('deal.days')}</bdi>&nbsp;{pad(p.h)}</> : pad(hours)}<span className="mx-1 text-brand-400">:</span>{pad(p.m)}<span className="mx-1 text-brand-400">:</span>{pad(p.s)}
      </span>
    );
  }
  const cells: [number, string][] = [...(p.d > 0 ? [[p.d, t('deal.days')] as [number, string]] : []), [p.h, t('deal.hours')], [p.m, t('deal.minutes')], [p.s, t('deal.seconds')]];
  return (
    <span className={`tabular inline-flex items-center gap-1 ${className}`} dir="ltr" role="timer" aria-live="off">
      {cells.map(([v, u], i) => (
        <span key={i} className="inline-flex items-baseline rounded-md bg-ink-900 px-1.5 py-0.5 text-xs font-bold text-white">
          {pad(v)}<span className="ms-0.5 text-[11px] font-medium text-white/70">{u}</span>
        </span>
      ))}
    </span>
  );
}
