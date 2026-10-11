'use client';

import { EyeOff, ExternalLink, Eye, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfig } from '@/components/layout/Providers';
import { Badge, Card, Dialog, EmptyState, ErrorState, PageHeader, SkeletonRows, Spinner, Stat, Table, Tabs, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatNumber } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useAction, useApi, useUrlState } from '@/lib/use-api';

interface Settings { pinned: string[]; hidden: string[]; synonyms: string[][] }
interface Row { query: string; searches: number; visitors: number; zeroResults: number; corrected: number; lastTotal: number; hidden: boolean }
interface Report {
  days: number;
  totals: { searches: number; visitors: number; zero: number; corrected: number; distinct: number; zeroPercent: number };
  daily: { day: string; searches: number; zero: number }[];
  top: Row[];
  zeroResults: Row[];
  settings: Settings;
}

const PERIODS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const;

/** What customers search for and do not find, and the search settings that fix it (synonyms, popular searches). */
export function SearchInsightsPage() {
  const { can } = useSession();
  const { storefrontUrl, country } = useConfig();
  const [state, setState] = useUrlState({ days: '30', tab: 'top' });
  const period = state.days;
  const tab = state.tab === 'zero' ? 'zero' : 'top';
  const setPeriod = (days: string) => setState({ days });
  const setTab = (t: 'top' | 'zero') => setState({ tab: t });
  const report = useApi<Report>(`/admin/search/report?days=${period}`);
  const { busy, run } = useAction();
  const [synonymFor, setSynonymFor] = useState<string | null>(null);
  const canEdit = can('countries.manage');

  async function saveSettings(next: Settings, message: string) {
    const r = await run('settings', () => api(`/admin/countries/${country}`, { method: 'PATCH', body: { searchSettings: next } }), message);
    if (r !== undefined) report.reload();
    return r !== undefined;
  }

  const settings = report.data?.settings;
  const toggleHidden = (q: string) => {
    if (!settings) return;
    const hidden = settings.hidden.includes(q) ? settings.hidden.filter((h) => h !== q) : [...settings.hidden, q];
    void saveSettings({ ...settings, hidden }, settings.hidden.includes(q) ? `“${q}” can show as a popular search again.` : `“${q}” will not show as a popular search.`);
  };

  const rows = tab === 'zero' ? report.data?.zeroResults : report.data?.top;
  const t = report.data?.totals;

  return (
    <>
      <PageHeader
        title="Search"
        description="What customers type in the search box, and what they could not find. Counts only — the log never records who searched."
        actions={
          <div className="flex gap-1 rounded-xl bg-ink-100 p-1" role="group" aria-label="Period">
            {PERIODS.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setPeriod(v)} aria-pressed={period === v} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${period === v ? 'bg-white shadow-sm' : 'text-ink-600'}`}>{l}</button>
            ))}
          </div>
        }
      />
      {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="search-stats">
        <Stat label="Searches" value={t ? formatNumber(t.searches) : '…'} sub={t ? `${formatNumber(t.distinct)} different searches` : undefined} />
        <Stat label="Visitors who searched" value={t ? formatNumber(t.visitors) : '…'} sub="counted once a day per search" />
        <Stat label="Found nothing" value={t ? `${t.zeroPercent}%` : '…'} sub={t ? `${formatNumber(t.zero)} searches` : undefined} tone={t && t.zeroPercent >= 15 ? 'warn' : undefined} />
        <Stat label="Fixed by spelling" value={t ? formatNumber(t.corrected) : '…'} sub="showed results for a corrected word" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" bodyClassName="p-0">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'top', label: 'Top searches', count: report.data?.top.length ?? null },
            { value: 'zero', label: 'No results', count: report.data?.zeroResults.length ?? null },
          ]} />
          {tab === 'zero' ? (
            <p className="border-b border-ink-100 px-5 py-3 text-sm text-ink-600">
              Customers looked for these and found nothing. Add the product, or add a synonym so the search finds what you already sell (for example “mobile” → “phone”).
            </p>
          ) : null}
          <Table>
            <thead>
              <tr>
                <th className="th">Search</th><th className="th text-end">Searches</th><th className="th text-end">Visitors</th>
                <th className="th text-end">{tab === 'zero' ? 'Found nothing' : 'Results now'}</th><th className="th text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!report.data ? <SkeletonRows cols={5} /> : rows?.map((r) => (
                <tr key={r.query} data-testid="search-row">
                  <td className="td">
                    <a href={`${storefrontUrl}/en/search?q=${encodeURIComponent(r.query)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-ink-900 hover:text-brand-700">
                      {r.query}<ExternalLink className="size-3.5 text-ink-400" aria-hidden />
                    </a>
                    {r.hidden ? <Badge tone="gray" className="ms-2">Hidden</Badge> : null}
                    {r.corrected ? <p className="text-xs text-ink-500">{formatNumber(r.corrected)}× answered with a spelling correction</p> : null}
                  </td>
                  <td className="td text-end tabular">{formatNumber(r.searches)}</td>
                  <td className="td text-end tabular">{formatNumber(r.visitors)}</td>
                  <td className="td text-end tabular">{tab === 'zero' ? formatNumber(r.zeroResults) : formatNumber(r.lastTotal)}</td>
                  <td className="td text-end whitespace-nowrap">
                    {canEdit ? (
                      <>
                        {tab === 'zero' ? (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setSynonymFor(r.query)} data-testid="add-synonym"><Link2 className="size-4" aria-hidden />Synonym</button>
                        ) : null}
                        <button type="button" className="btn-ghost btn-sm" onClick={() => toggleHidden(r.query)} disabled={busy === 'settings'} title={r.hidden ? 'Allow as a popular search' : 'Never show as a popular search'} data-testid="toggle-hidden">
                          {r.hidden ? <><Eye className="size-4" aria-hidden />Show</> : <><EyeOff className="size-4" aria-hidden />Hide</>}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {report.data && !rows?.length ? (
            <EmptyState title={tab === 'zero' ? 'Every search found something' : 'No searches yet'} description={tab === 'zero' ? 'Nothing to fix for this period.' : 'Searches show here a few minutes after customers make them.'} />
          ) : null}
        </Card>

        {settings ? <SettingsCard settings={settings} canEdit={canEdit} busy={busy === 'settings'} onSave={saveSettings} /> : <Card title="Search settings"><SkeletonRows cols={1} rows={4} /></Card>}
      </div>

      <SynonymDialog query={synonymFor} onClose={() => setSynonymFor(null)} onSave={async (word) => {
        if (!settings || !synonymFor) return;
        const group = settings.synonyms.find((g) => g.includes(word.toLowerCase()));
        const synonyms = group ? settings.synonyms.map((g) => (g === group ? [...g, synonymFor] : g)) : [...settings.synonyms, [synonymFor, word]];
        if (await saveSettings({ ...settings, synonyms }, `Searching “${synonymFor}” now also finds “${word}”.`)) setSynonymFor(null);
      }} />
    </>
  );
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function SettingsCard({ settings, canEdit, busy, onSave }: { settings: Settings; canEdit: boolean; busy: boolean; onSave: (s: Settings, message: string) => Promise<boolean> }) {
  const [pinned, setPinned] = useState(settings.pinned.join('\n'));
  const [synonyms, setSynonyms] = useState(settings.synonyms.map((g) => g.join(', ')).join('\n'));
  useEffect(() => {
    setPinned(settings.pinned.join('\n'));
    setSynonyms(settings.synonyms.map((g) => g.join(', ')).join('\n'));
  }, [settings]);

  return (
    <Card title="Search settings" description="Applies to the website and the app straight away.">
      <div className="space-y-5" data-testid="search-settings">
        <TextArea
          label="Popular searches to show first"
          hint="One per line, up to 10. Shown when a customer taps the search box and on “no results” pages, before the searches customers use most."
          rows={4} value={pinned} onChange={(e) => setPinned(e.target.value)} disabled={!canEdit} name="pinned"
        />
        <TextArea
          label="Synonyms"
          hint="One group per line, separated by commas: words that should find each other, in English and Arabic. Example: mobile, phone, جوال"
          rows={6} value={synonyms} onChange={(e) => setSynonyms(e.target.value)} disabled={!canEdit} name="synonyms" dir="auto"
        />
        {settings.hidden.length ? (
          <div>
            <p className="label">Hidden from popular searches</p>
            <ul className="flex flex-wrap gap-2">
              {settings.hidden.map((h) => (
                <li key={h}>
                  <button type="button" className="chip" disabled={!canEdit || busy} onClick={() => onSave({ ...settings, hidden: settings.hidden.filter((x) => x !== h) }, `“${h}” can show as a popular search again.`)} title="Allow again">
                    {h} <Eye className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canEdit ? (
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={busy} data-testid="save-search-settings"
              onClick={() => onSave({ ...settings, pinned: lines(pinned), synonyms: lines(synonyms).map((l) => l.split(',').map((w) => w.trim()).filter(Boolean)) }, 'Search settings saved.')}>
              {busy ? <Spinner /> : null} Save search settings
            </button>
          </div>
        ) : <p className="text-sm text-ink-500">Only staff who manage store settings can change these.</p>}
      </div>
    </Card>
  );
}

function SynonymDialog({ query, onClose, onSave }: { query: string | null; onClose: () => void; onSave: (word: string) => Promise<void> }) {
  const [word, setWord] = useState('');
  useEffect(() => setWord(''), [query]);
  return (
    <Dialog
      open={query !== null}
      onClose={onClose}
      title={`Make “${query ?? ''}” find something`}
      description="Type a word your products use that means the same. Both will find each other from now on."
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={word.trim().length < 2} onClick={() => onSave(word.trim())} data-testid="save-synonym">Add synonym</button>
      </>}
    >
      <TextField label="Same meaning as" value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. phone" autoFocus dir="auto" name="synonym" />
    </Dialog>
  );
}
