'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

const EVENT = 'fmx:navstart';

/** Call before a `router.push` so the purple line starts at once (taps on links start it by themselves). */
export function startNav(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Is this click a normal in-app page change (not a new tab, a download, the same page or another site)? */
function isPageChange(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.target as Element | null;
  const a = target?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return false;
  // a button inside a link (the heart on a product card) does its own thing
  const control = target?.closest?.('button, [role="button"], input, select, textarea, label');
  if (control && a.contains(control)) return false;
  if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return false;
  let url: URL;
  try { url = new URL(a.href, location.href); } catch { return false; }
  if (url.origin !== location.origin) return false;
  // only the #part changes: the page stays
  return url.pathname !== location.pathname || url.search !== location.search;
}

/**
 * The thin purple line at the very top that starts the moment a link is tapped and runs until the new page is
 * there (like the Amazon / YouTube apps), so a tap never looks like nothing happened, even on a slow connection.
 */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);
  const running = useRef(false);

  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  useEffect(() => {
    function start() {
      if (running.current) return;
      running.current = true;
      clear();
      setVisible(true);
      setWidth(8);
      // creeps forward quickly at first, then slower, never reaching the end on its own
      const steps = [[60, 30], [300, 55], [800, 70], [1600, 80], [3000, 88], [6000, 93]] as const;
      for (const [ms, w] of steps) later(() => setWidth(w), ms);
      // a page that never comes (offline, an error page that replaced nothing): give up quietly
      later(() => finish(), 15_000);
    }
    const onClick = (e: MouseEvent) => { if (isPageChange(e)) start(); };
    const onPop = () => start();
    // capture: runs before the link's own handler takes the click over for in-app navigation
    document.addEventListener('click', onClick, true);
    window.addEventListener(EVENT, start);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(EVENT, start);
      window.removeEventListener('popstate', onPop);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    if (!running.current) return;
    running.current = false;
    clear();
    setWidth(100);
    later(() => setVisible(false), 220);
    later(() => setWidth(0), 480);
  }

  // the new page is in place
  useEffect(() => { finish(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px]" data-testid="nav-progress" data-active={visible ? '1' : undefined}>
      <div
        className="h-full origin-left bg-gradient-to-r from-[#C13CFE] to-[#6711FA] shadow-[0_0_8px_rgb(116_34_230/0.6)] rtl:origin-right"
        style={{
          transform: `scaleX(${width / 100})`,
          opacity: visible ? 1 : 0,
          transition: `transform ${width === 0 ? 0 : width === 100 ? 180 : 400}ms ease-out, opacity 240ms ease-out`,
        }}
      />
    </div>
  );
}

export function NavProgress() {
  return <Suspense fallback={null}><Bar /></Suspense>;
}
