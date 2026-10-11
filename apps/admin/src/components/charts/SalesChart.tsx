'use client';

import { useId, useMemo, useState } from 'react';
import { formatMoney, formatNumber } from '@/lib/format';

export interface Point { t: string; orders: number; gmvMinor: string }

const W = 720;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function label(t: string, bucket: string): string {
  // Buckets arrive as local Qatar wall-clock times ("2026-09-24T00:00:00").
  const [date, time] = t.split('T');
  const [, m, d] = date.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  if (bucket === 'hour') return time.slice(0, 5);
  if (bucket === 'month') return `${month} ${date.slice(2, 4)}`;
  return `${d} ${month}`;
}

/** Sales over time: revenue as an area, orders in the tooltip. Plain SVG, no chart library. */
export function SalesChart({ points, bucket, currency }: { points: Point[]; bucket: string; currency: string }) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const values = useMemo(() => points.map((p) => Number(BigInt(p.gmvMinor) / 100n)), [points]);
  const max = niceMax(Math.max(0, ...values));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const step = points.length > 1 ? iw / (points.length - 1) : 0;
  const x = (i: number) => PAD.left + (points.length > 1 ? i * step : iw / 2);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;

  if (points.length === 0) return <p className="py-16 text-center text-sm text-ink-500">No sales in this period.</p>;

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(1)},${PAD.top + ih} L${x(0).toFixed(1)},${PAD.top + ih} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(points.length / 8));
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`Revenue per ${bucket}, highest ${formatMoney(String(Math.max(0, ...values) * 100), currency, { compact: true })}`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round((px - PAD.left) / (step || 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7422E6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#7422E6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#efebe6" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#776e64">{t >= 1000 ? `${formatNumber(t / 1000)}k` : formatNumber(t)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          (i % every === 0 && points.length - 1 - i >= every / 2) || i === points.length - 1 ? (
            <text key={p.t} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#776e64">{label(p.t, bucket)}</text>
          ) : null,
        )}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="#7422E6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="#cbc3b9" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(values[hover])} r="4.5" fill="#fff" stroke="#7422E6" strokeWidth="2" />
          </g>
        ) : null}
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-0 rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${hover! > points.length / 2 ? '-105%' : '5%'})` }}
        >
          <p className="font-semibold">{label(h.t, bucket)}</p>
          <p className="tabular">{formatMoney(h.gmvMinor, currency)}</p>
          <p className="text-white/70 tabular">{h.orders} {h.orders === 1 ? 'order' : 'orders'}</p>
        </div>
      ) : null}
    </div>
  );
}
