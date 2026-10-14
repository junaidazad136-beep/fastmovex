'use client';

import { ScanLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import type { SearchResult } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { paths } from '@/lib/urls';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';
import { startNav } from '@/components/layout/NavProgress';

/**
 * Camera barcode search: the back camera reads the EAN/UPC on the pack (ZXing, works on iPhone and Android), then the
 * product opens directly, or the search results when several match. The number can also be typed.
 */
export function BarcodeScanner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'looking' | 'no-camera'>('starting');
  const [missing, setMissing] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  async function find(code: string) {
    setState('looking');
    setMissing(null);
    try {
      const r = await api<SearchResult>(`/search?q=${encodeURIComponent(code)}&limit=2`, { auth: 'none' });
      if (r.total === 1 && r.items[0]) { onClose(); startNav(); router.push(paths.product(t.locale, r.items[0].slug)); return; }
      if (r.total > 1) { onClose(); startNav(); router.push(paths.search(t.locale, { q: code })); return; }
      setMissing(code);
    } catch {
      setMissing(code);
    }
    setState('scanning');
  }

  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    setState('starting');
    setMissing(null);
    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]]]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
        if (cancelled || !video.current) return;
        let busy = false;
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current, (result) => {
          if (!result || busy) return;
          busy = true;
          navigator.vibrate?.(60);
          find(result.getText()).finally(() => { window.setTimeout(() => { busy = false; }, 1500); });
        });
        stop = () => controls.stop();
        if (cancelled) stop();
        else setState('scanning');
      } catch {
        if (!cancelled) setState('no-camera');
      }
    })();
    return () => { cancelled = true; stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the dialog opens
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={t('search.scanTitle')} closeLabel={t('common.close')}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-ink-900">
        <video ref={video} className="size-full object-cover" muted playsInline aria-hidden />
        {state !== 'no-camera' ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(11,7,19,0.45)]">
            <ScanLine className="absolute inset-x-0 top-1/2 mx-auto size-8 -translate-y-1/2 text-brand-300" />
          </div>
        ) : null}
        {state === 'starting' || state === 'looking' ? <div className="absolute inset-0 flex items-center justify-center"><Spinner /></div> : null}
      </div>
      <p className="mt-3 text-sm text-ink-600" role="status">
        {state === 'no-camera' ? t('search.scanNoCamera') : missing ? t('search.scanNotFound', { code: missing }) : t('search.scanHint')}
      </p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = typed.replace(/\s/g, ''); if (c) find(c); }}>
        <label className="sr-only" htmlFor="scan-typed">{t('search.scanTyped')}</label>
        <input id="scan-typed" className="input" inputMode="numeric" autoComplete="off" dir="ltr" placeholder={t('search.scanTyped')} value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={40} />
        <button type="submit" className="btn-primary shrink-0" disabled={state === 'looking'}>{t('search.scanFind')}</button>
      </form>
    </Dialog>
  );
}
