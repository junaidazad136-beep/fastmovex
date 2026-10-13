'use client';

import { CheckCircle2, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';

interface ScanResult { id: string; orderNumber: string; status: string; pickedUp: boolean }

/**
 * At the seller's shop: scan the QR on each parcel's label. Your own assigned parcel is picked up in one step; a
 * parcel already picked up just says so; anything else is refused (wrong parcel, not given to you). The camera keeps
 * running so a stack of parcels is scanned one after another.
 */
export function ScanParcel({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'checking' | 'no-camera'>('starting');
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [count, setCount] = useState(0);

  async function check(code: string) {
    setState('checking');
    try {
      const r = await api<ScanResult>('/courier/jobs/scan', { method: 'POST', body: { code } });
      navigator.vibrate?.(r.pickedUp ? [60, 40, 60] : 60);
      setLast({ ok: true, text: r.pickedUp ? `${r.orderNumber} — picked up` : `${r.orderNumber} — already picked up` });
      if (r.pickedUp) { setCount((n) => n + 1); onPicked(); }
    } catch (e) {
      navigator.vibrate?.([200]);
      setLast({ ok: false, text: errorMessage(e) });
    }
    setState('scanning');
  }

  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    setState('starting');
    setLast(null);
    setCount(0);
    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]), { delayBetweenScanAttempts: 150 });
        if (cancelled || !video.current) return;
        let busy = false;
        let lastText = '';
        let lastAt = 0;
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current, (result) => {
          if (!result || busy) return;
          const text = result.getText();
          // the same label stays in view: do not send it again for a few seconds
          if (text === lastText && Date.now() - lastAt < 4000) return;
          busy = true;
          lastText = text;
          lastAt = Date.now();
          check(text).finally(() => { window.setTimeout(() => { busy = false; }, 800); });
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
    <Dialog open={open} onClose={onClose} title="Scan parcel labels" description="Point the camera at the QR on each parcel at the seller.">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-ink-900">
        <video ref={video} className="size-full object-cover" muted playsInline aria-hidden />
        {state !== 'no-camera' ? (
          <div aria-hidden className="pointer-events-none absolute inset-12 rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(11,7,19,0.45)]">
            <ScanLine className="absolute inset-x-0 top-1/2 mx-auto size-8 -translate-y-1/2 text-brand-300" />
          </div>
        ) : null}
        {state === 'starting' || state === 'checking' ? <div className="absolute inset-0 flex items-center justify-center"><Spinner className="size-6 text-white" /></div> : null}
      </div>
      <div className="mt-3 space-y-2 text-sm" role="status" data-testid="scan-status">
        {state === 'no-camera' ? <p className="text-ink-600">The camera is not available. Use the “Picked up” button on each job instead.</p> : null}
        {last ? <p className={last.ok ? 'flex items-center gap-2 font-semibold text-success-700' : 'font-semibold text-danger-600'}>{last.ok ? <CheckCircle2 className="size-4" aria-hidden /> : null}{last.text}</p> : null}
        {count ? <p className="text-ink-600">{count} parcel{count === 1 ? '' : 's'} picked up</p> : null}
      </div>
      <button type="button" className="btn-primary mt-4 w-full" onClick={onClose}>Done</button>
    </Dialog>
  );
}
