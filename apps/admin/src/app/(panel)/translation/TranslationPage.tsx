'use client';

import { Languages, RefreshCw } from 'lucide-react';
import { Badge, Card, ErrorState, Loading, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/state/session';
import { useAction, useApi } from '@/lib/use-api';

interface Status {
  provider: 'deepl' | 'fake' | 'off';
  state: 'ok' | 'quota' | 'key' | 'error' | 'off';
  lastError: string | null;
  pausedUntil: string | null;
  usage: { used: number; limit: number } | null;
  waiting: number;
  autoTranslated: number;
  withoutArabic: number;
}

const STATE: Record<Status['state'], { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  ok: { label: 'Working', tone: 'green' },
  quota: { label: 'Monthly allowance used up', tone: 'amber' },
  key: { label: 'Key refused', tone: 'red' },
  error: { label: 'Paused for a moment', tone: 'amber' },
  off: { label: 'Off', tone: 'gray' },
};

const n = (x: number) => x.toLocaleString('en-GB');

/**
 * Sellers write in English or Arabic; DeepL writes the other language for product names, short lines, descriptions,
 * option words and store "about" text. This page shows whether it is on, how much of the month's allowance is used,
 * and lets staff run the queue at once.
 */
export function TranslationPage() {
  const { can } = useSession();
  const st = useApi<Status>('/admin/translation');
  const { run, busy } = useAction();

  async function runNow() {
    const r = await run('run', () => api<Status & { products: number; stores: number }>('/admin/translation/run', { method: 'POST' }), (x) => `Translated ${x.products} products and ${x.stores} store pages`);
    if (r !== undefined) st.reload();
  }

  const s = st.data;
  const pct = s?.usage ? Math.min(100, Math.round((s.usage.used / Math.max(1, s.usage.limit)) * 100)) : 0;
  return (
    <>
      <PageHeader
        title="Arabic translation"
        description="Sellers write in English or Arabic; the other language is written automatically for product names, short lines, descriptions, option words (Colour, Black…) and store pages. Brand names, model numbers and sizes are kept as they are. Text a seller or staff member changes by hand is never overwritten."
        actions={can('products.manage') && s && s.provider !== 'off' ? (
          <button type="button" className="btn-primary" onClick={runNow} disabled={busy === 'run'} data-testid="translation-run">
            {busy === 'run' ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />} Translate waiting now
          </button>
        ) : null}
      />
      {st.error ? <ErrorState error={st.error} onRetry={st.reload} /> : !s ? <Loading /> : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Status" className="lg:col-span-2">
            <div className="space-y-4 text-sm" data-testid="translation-status">
              <p className="flex flex-wrap items-center gap-2">
                <Languages className="size-5 text-brand-600" aria-hidden />
                <span className="font-semibold">{s.provider === 'deepl' ? 'DeepL' : s.provider === 'fake' ? 'Test translator' : 'Not connected'}</span>
                <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
              </p>
              {s.provider === 'off' ? (
                <div className="rounded-xl bg-ink-50 p-4 text-ink-700">
                  <p className="font-medium">To switch it on</p>
                  <ol className="mt-2 list-decimal space-y-1 ps-5">
                    <li>Make a free account at deepl.com (API Free plan) and copy the key under Account → API keys.</li>
                    <li>On Render, open the API service → Environment, add <code className="rounded bg-white px-1">DEEPL_API_KEY</code> with that key, and save.</li>
                    <li>After the API restarts, this page shows “Working” and every product gets its Arabic within minutes.</li>
                  </ol>
                </div>
              ) : null}
              {s.lastError && s.state !== 'ok' ? <p className="rounded-xl bg-warning-50 px-3 py-2 text-warning-600">{s.lastError}{s.pausedUntil ? ` — tries again at ${new Date(s.pausedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</p> : null}
              {s.usage ? (
                <div>
                  <div className="flex justify-between text-ink-600"><span>This month</span><span className="tabular-nums">{n(s.usage.used)} / {n(s.usage.limit)} characters</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly allowance used">
                    <div className={`h-full rounded-full ${pct >= 90 ? 'bg-danger-600' : pct >= 70 ? 'bg-warning-600' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-ink-500">About 1,000–1,500 characters per product. Only new or changed text is sent.</p>
                </div>
              ) : null}
            </div>
          </Card>
          <Card title="Products">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-600">Waiting to be checked</dt><dd className="tabular-nums font-semibold" data-testid="translation-waiting">{n(s.waiting)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-600">With automatic text</dt><dd className="tabular-nums font-semibold">{n(s.autoTranslated)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-600">Still without an Arabic name</dt><dd className="tabular-nums font-semibold">{n(s.withoutArabic)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-ink-500">The waiting list is worked through every minute. Automatic text is marked “Auto” in the product editor.</p>
          </Card>
        </div>
      )}
    </>
  );
}
