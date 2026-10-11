'use client';

import { Check, ChevronDown, MapPin } from 'lucide-react';
import { Suspense, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { Dialog } from '../ui/Dialog';
import { LocaleSwitch } from './LocaleSwitch';

/** "📍 Qatar ▾" in the header: where we deliver (one market for now) and the language. */
export function LocationButton({ country, flag }: { country: string; flag: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-xl px-1.5 py-2 text-[14px] font-medium sm:text-[15px] text-ink-900 hover:bg-ink-100 sm:px-2.5"
        aria-label={`${t('nav.deliverTo')} ${country}`}
        data-testid="location-button"
      >
        <MapPin className="size-5 text-ink-800" strokeWidth={2.1} aria-hidden />
        <span>{country}</span>
        <ChevronDown className="size-4 text-ink-600" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('nav.chooseMarket')} closeLabel={t('common.close')}>
        <ul className="space-y-2">
          <li>
            <span className="flex items-center gap-3 rounded-xl border-2 border-brand-600 bg-brand-50 px-4 py-3">
              <span className="text-2xl" aria-hidden>{flag}</span>
              <span className="flex-1 font-semibold text-ink-900">{country}</span>
              <Check className="size-5 text-brand-600" aria-hidden />
            </span>
          </li>
        </ul>
        <p className="mt-3 text-sm text-ink-500">{t('nav.marketOnly', { country })}</p>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <Suspense fallback={null}><LocaleSwitch className="text-sm text-brand-700 hover:bg-brand-50" /></Suspense>
        </div>
      </Dialog>
    </>
  );
}
