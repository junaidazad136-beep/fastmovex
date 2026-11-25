'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** One piece of the document that is never cut in half (a heading with its first paragraph, a paragraph, a list item, a table). */
export interface DocBlock { key: string; node: ReactNode; space: number; anchor?: string; className?: string }

interface Labels { title: string; pageOf: string; pages: string; frame: string }

const A4_W = 794; // an A4 sheet at 96 dpi: 794 x 1123
const RATIO = 297 / 210;

/** Greedy fill: blocks go onto a page until the next one would not fit. */
function paginate(heights: number[], limit: number): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  heights.forEach((h, i) => {
    const cur = pages[pages.length - 1];
    if (cur.length > 0 && used + h > limit) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(i);
    used += h;
  });
  return pages;
}

const BODY = 'text-[14px] leading-[1.75] text-ink-800 sm:text-[15px]';

/**
 * The document viewer: a frame with white A4 sheets one under the other (page 1, scroll, page 2 …), each with a running
 * header, its text and "Page n of N" at the foot. The pages are cut in the browser from the measured blocks, so they
 * follow the screen width (a phone gets narrower sheets with the same A4 shape). Without JavaScript, and when printing,
 * the whole text is one continuous sheet and the browser cuts the A4 pages itself.
 */
export function PagedDocument({ blocks, labels }: { blocks: DocBlock[]; labels: Labels }) {
  const host = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ w: number; h: number; pad: number; pages: number[][] } | null>(null);

  const layout = useCallback(() => {
    const el = host.current; const m = meter.current;
    if (!el || !m) return;
    const w = Math.max(280, Math.min(A4_W, Math.floor(el.clientWidth)));
    const pad = w >= 600 ? Math.round(w * 0.09) : 20;
    const h = Math.round(w * RATIO);
    const contentW = w - pad * 2;
    const contentH = h - pad - (pad + 18); // top padding, bottom padding plus the footer line
    m.style.width = `${contentW}px`;
    const heights = Array.from(m.children).map((c) => (c as HTMLElement).offsetHeight);
    const pages = paginate(heights, contentH);
    setGeo((g) => (g && g.w === w && g.h === h && JSON.stringify(g.pages) === JSON.stringify(pages) ? g : { w, h, pad, pages }));
  }, []);

  useLayoutEffect(() => { layout(); }, [layout, blocks]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
    const ro = new ResizeObserver(again);
    ro.observe(el);
    document.fonts?.ready.then(again).catch(() => {});
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [layout]);

  // a link to "#section" jumps to the page that holds it
  useEffect(() => {
    if (!geo) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [geo?.pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = geo?.pages.length ?? 1;
  const spaced = (b: DocBlock, ids: boolean) => (
    <div key={b.key} id={ids ? b.anchor : undefined} className={`scroll-mt-28 ${b.className ?? ''}`} style={{ paddingBottom: b.space }}>{b.node}</div>
  );

  return (
    <div ref={host} className="w-full" data-testid="policy-viewer">
      <div className="mx-auto" style={{ maxWidth: A4_W }}>
        {/* viewer bar */}
        <div className="flex items-center justify-between gap-3 rounded-t-lg bg-ink-800 px-4 py-2.5 text-xs text-white print:hidden">
          <span className="min-w-0 truncate font-semibold">{labels.title}</span>
          <span className="shrink-0 tabular text-white/80" data-testid="policy-pagecount">{geo ? labels.pages.replace('{total}', String(total)) : ''}</span>
        </div>
      </div>

      {/* measuring copy (invisible): same text, same width as a page's text area */}
      <div className="h-0 overflow-hidden print:hidden" aria-hidden>
        <div ref={meter} className={`pointer-events-none invisible ${BODY}`}>{blocks.map((b) => <div key={b.key} className={b.className} style={{ paddingBottom: b.space }}>{b.node}</div>)}</div>
      </div>

      {/* the pages */}
      {geo ? (
        <div className="space-y-5 bg-ink-300/40 py-5 print:hidden" role="group" aria-label={labels.frame} data-testid="policy-pages">
          {geo.pages.map((idx, n) => (
            <section
              key={n}
              aria-label={labels.pageOf.replace('{n}', String(n + 1)).replace('{total}', String(total))}
              data-testid={`policy-page-sheet-${n + 1}`}
              className="relative mx-auto overflow-hidden bg-white shadow-[0_1px_3px_rgba(40,30,20,.18),0_10px_30px_rgba(40,30,20,.12)]"
              style={{ width: geo.w, height: geo.h, padding: `${geo.pad}px ${geo.pad}px 0` }}
            >
              {n > 0 ? (
                <p className="absolute inset-x-0 text-center text-[10px] uppercase tracking-wide text-ink-400" style={{ top: Math.max(8, geo.pad / 2.4) }}>{labels.title}</p>
              ) : null}
              <div className={BODY}>{idx.map((i) => spaced(blocks[i], true))}</div>
              <p className="absolute inset-x-0 flex items-center justify-between text-[10px] text-ink-500" style={{ bottom: Math.max(10, geo.pad / 2.2), paddingInline: geo.pad }}>
                <span>FastMoveX</span>
                <span className="tabular">{labels.pageOf.replace('{n}', String(n + 1)).replace('{total}', String(total))}</span>
              </p>
            </section>
          ))}
        </div>
      ) : null}

      {/* continuous copy: shown while the pages are not cut yet (and without JavaScript) and always when printing */}
      <div className={`mx-auto bg-white px-5 py-8 sm:px-[72px] sm:py-[64px] print:block print:p-0 print:shadow-none ${geo ? 'hidden' : ''} ${BODY}`} style={{ maxWidth: A4_W }} data-testid="policy-continuous">
        {blocks.map((b) => spaced(b, false))}
      </div>
    </div>
  );
}
