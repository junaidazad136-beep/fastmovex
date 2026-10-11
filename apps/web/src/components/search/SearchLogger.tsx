'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api/client';

/**
 * Tells the shop what was searched and whether anything was found (anonymous counts, used for popular searches and
 * the staff search report). Sent from the browser so bots and prefetches do not count; once per search per visit.
 */
export function SearchLogger({ q, total, corrected }: { q: string; total: number; corrected: boolean }) {
  useEffect(() => {
    const key = `jovia.searched:${q.toLowerCase()}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* storage blocked: log anyway */ }
    api('/search/log', { method: 'POST', auth: 'none', body: { q, total, corrected } }).catch(() => { /* statistics only */ });
  }, [q, total, corrected]);
  return null;
}
