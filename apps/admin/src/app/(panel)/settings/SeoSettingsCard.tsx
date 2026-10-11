'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfig } from '@/components/layout/Providers';
import { Card, Spinner, Switch, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useToast } from '@/lib/state/toast';
import { useAction } from '@/lib/use-api';

const NETWORKS = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['snapchat', 'Snapchat'], ['facebook', 'Facebook'], ['x', 'X (Twitter)'], ['youtube', 'YouTube'], ['linkedin', 'LinkedIn']] as const;
type Net = (typeof NETWORKS)[number][0];
interface Seo { googleVerification: string | null; bingVerification: string | null; social: Partial<Record<Net, string>>; merchantFeed: boolean }

/** Google / Bing site ownership, social profiles (they appear with the shop in Google) and the Google Shopping feed. */
export function SeoSettingsCard({ countryCode, stored, onSaved }: { countryCode: string; stored: unknown; onSaved: () => void }) {
  const { storefrontUrl } = useConfig();
  const toast = useToast();
  const { busy, run } = useAction();
  const read = (): Seo => ({ googleVerification: null, bingVerification: null, social: {}, merchantFeed: true, ...((stored ?? {}) as Partial<Seo>) });
  const [v, setV] = useState<Seo>(read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setV(read()), [stored]);
  async function save() {
    const ok = await run('seo', () => api(`/admin/countries/${countryCode}`, { method: 'PATCH', body: { seoSettings: { ...v, googleVerification: v.googleVerification?.trim() || null, bingVerification: v.bingVerification?.trim() || null } } }), 'Search engine settings saved');
    if (ok !== undefined) onSaved();
  }
  const feeds = [`${storefrontUrl}/feeds/google-en.xml`, `${storefrontUrl}/feeds/google-ar.xml`];
  const links = [`${storefrontUrl}/sitemap.xml`, ...feeds];
  return (
    <Card title="Google & social" description="Prove to Google and Bing that the website is yours, link your social pages, and list your products on Google Shopping for free." className="xl:col-span-2">
      <div className="space-y-4" data-testid="seo-settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Google Search Console code" hint="Search Console → Add property → HTML tag: paste the tag or just its code." value={v.googleVerification ?? ''} onChange={(e) => setV({ ...v, googleVerification: e.target.value })} placeholder="e.g. 3kP0x…" />
          <TextField label="Bing Webmaster code" hint="Bing Webmaster Tools → Add site → Meta tag." value={v.bingVerification ?? ''} onChange={(e) => setV({ ...v, bingVerification: e.target.value })} />
        </div>
        <div>
          <p className="label">Social pages</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NETWORKS.map(([k, label]) => (
              <TextField key={k} label={label} value={v.social[k] ?? ''} onChange={(e) => setV({ ...v, social: { ...v.social, [k]: e.target.value.trim() || undefined } })} placeholder={`https://${k === 'x' ? 'x' : k}.com/fastmovex.qa`} dir="ltr" />
            ))}
          </div>
        </div>
        <Switch checked={v.merchantFeed} onChange={(merchantFeed) => setV({ ...v, merchantFeed })} label="Product feed for Google Shopping" description="Google Merchant Center → Products → Add feed → Scheduled fetch, with the addresses below (one per language). Free listings show your products with photo and price on Google." />
        <ul className="space-y-1.5 text-sm" data-testid="seo-links">
          {links.map((u) => (
            <li key={u} className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-ink-50 px-2 py-1 text-xs" dir="ltr">{u}</code>
              <button type="button" className="rounded p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => { void navigator.clipboard?.writeText(u); toast.success('Copied'); }} aria-label={`Copy ${u}`}><Copy className="size-3.5" aria-hidden /></button>
              <a className="rounded p-1.5 text-ink-500 hover:bg-ink-100" href={u} target="_blank" rel="noopener noreferrer" aria-label={`Open ${u}`}><ExternalLink className="size-3.5" aria-hidden /></a>
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><button type="button" className="btn-primary" disabled={busy === 'seo'} onClick={save} data-testid="seo-save">{busy === 'seo' ? <Spinner /> : null}Save</button></div>
      </div>
    </Card>
  );
}
