'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

/** Light / dark. Saved in a cookie (read by the server for the first paint) for a year. */
export function ThemeToggle({ variant = 'icon', className = '' }: { variant?: 'icon' | 'row'; className?: string }) {
  const t = useT();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark'); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    document.cookie = `fmx_theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
  }
  const Icon = dark ? Sun : Moon;
  const label = dark ? t('common.lightMode') : t('common.darkMode');
  if (variant === 'row') {
    return (
      <button type="button" onClick={toggle} role="switch" aria-checked={dark} data-testid="theme-toggle" className={`flex w-full items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3.5 text-start ${className}`}>
        <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-700"><Icon className="size-[18px]" aria-hidden /></span>
        <span className="flex-1 text-[15px] font-semibold text-ink-900">{label}</span>
        <span aria-hidden className={`relative h-6 w-11 rounded-full transition-colors ${dark ? 'bg-brand-600' : 'bg-ink-200'}`}>
          <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${dark ? 'start-[22px]' : 'start-0.5'}`} />
        </span>
      </button>
    );
  }
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} data-testid="theme-toggle-icon" className={`rounded-lg p-1.5 text-white/90 hover:bg-white/10 hover:text-white ${className}`}>
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
