'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import Link from 'next/link';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; message: string; action?: { label: string; href?: string; onClick?: () => void } }

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite" role="status">
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info;
          return (
            <div key={t.id} className="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
              <Icon className={`mt-0.5 size-5 shrink-0 ${t.tone === 'success' ? 'text-emerald-400' : t.tone === 'error' ? 'text-red-400' : 'text-sky-300'}`} aria-hidden />
              <p className="flex-1 leading-snug">{t.message}</p>
              {t.action && (t.action.href ? (
                <Link href={t.action.href} className="shrink-0 font-semibold text-sand-300 underline-offset-2 hover:underline">{t.action.label}</Link>
              ) : (
                <button type="button" onClick={t.action.onClick} className="shrink-0 font-semibold text-sand-300">{t.action.label}</button>
              ))}
              <button type="button" onClick={() => dismiss(t.id)} className="shrink-0 text-white/60 hover:text-white" aria-label={closeLabel}>
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
