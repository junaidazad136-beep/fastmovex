'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Accessible modal built on the native <dialog> element (focus trap, Esc to close, inert background). */
/** `sheet`: on phones it slides up from the bottom edge (easier to reach and read), a centred box elsewhere. */
export function Dialog({ open, onClose, title, children, closeLabel, wide = false, sheet = false, subtitle }: { open: boolean; onClose: () => void; title: string; children: ReactNode; closeLabel: string; wide?: boolean; sheet?: boolean; subtitle?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl p-0 text-ink-900 shadow-[var(--shadow-pop)] backdrop:bg-ink-900/50 open:animate-[fade-in_160ms_ease-out] ${sheet ? 'max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none' : ''}`}
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-bold">{title}</h2>
          {subtitle && <p className="truncate text-[13px] text-ink-500">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label={closeLabel} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className={`overflow-y-auto px-5 py-4 ${sheet ? 'max-h-[75vh] max-sm:max-h-[80vh] max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'max-h-[75vh]'}`}>{children}</div>
    </dialog>
  );
}
