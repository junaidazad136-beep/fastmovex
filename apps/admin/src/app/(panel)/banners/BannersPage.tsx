'use client';

import { ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { checkImageFile } from '@/components/products/ImagesManager';
import { Badge, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Loading, PageHeader, SelectField, Spinner, Switch, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDate, fromQatarLocalInput, toQatarLocalInput } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';

const TEXT_KEYS = ['kicker', 'kickerAr', 'headline', 'headlineAr', 'subline', 'sublineAr', 'ctaLabel', 'ctaLabelAr'] as const;
type TextKey = (typeof TEXT_KEYS)[number];
type Texts = Record<TextKey, string>;
interface Banner extends Partial<Record<TextKey, string | null>> { id: string; placement: string; locale: string | null; linkUrl: string | null; sortOrder: number; startsAt: string | null; endsAt: string | null; isActive: boolean; imageUrl: string }
interface Form extends Texts { id?: string; placement: string; locale: string; linkUrl: string; sortOrder: string; startsAt: string; endsAt: string; isActive: boolean; file: File | null }

const noTexts = (): Texts => Object.fromEntries(TEXT_KEYS.map((k) => [k, ''])) as Texts;
const textsOf = (b: Banner): Texts => Object.fromEntries(TEXT_KEYS.map((k) => [k, b[k] ?? ''])) as Texts;

/** How the website draws a text banner: badge, headline (2 lines, *accent* words purple), line under it, button. */
function TextPreview({ f, ar }: { f: Form; ar: boolean }) {
  const pickT = (k: 'kicker' | 'headline' | 'subline' | 'ctaLabel') => (ar ? f[`${k}Ar`] || f[k] : f[k]);
  const headline = pickT('headline');
  if (!headline) return null;
  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="relative overflow-hidden rounded-xl bg-[linear-gradient(110deg,#0B0713_0%,#1E0B45_55%,#3A0F8F_100%)] p-4 text-white">
      {f.file ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={URL.createObjectURL(f.file)} alt="" className="absolute inset-y-0 end-0 h-full w-1/2 object-contain p-2" />
      ) : null}
      <div className="relative max-w-[60%]">
        {pickT('kicker') ? <span className="inline-block rounded-full bg-[#7422E6] px-2 py-0.5 text-[10px] font-bold uppercase">{pickT('kicker')}</span> : null}
        <p className="mt-1.5 text-xl leading-tight font-extrabold uppercase">
          {headline.split('\n').map((line, i) => (
            <span key={i} className="block">{line.split(/(\*[^*]+\*)/).map((part, j) => part.startsWith('*') && part.endsWith('*') ? <span key={j} className="text-[#C13CFE]">{part.slice(1, -1)}</span> : part)}</span>
          ))}
        </p>
        {pickT('subline') ? <p className="mt-1 text-xs text-white/80">{pickT('subline')}</p> : null}
        {pickT('ctaLabel') ? <span className="mt-2 inline-block rounded-full bg-[#7422E6] px-3 py-1 text-xs font-semibold">{pickT('ctaLabel')} →</span> : null}
      </div>
    </div>
  );
}

const PLACEMENTS = [
  { value: 'HOME_HERO', label: 'Home page — main slider', size: '1600 × 600 px (8:3)' },
  { value: 'HOME_MID', label: 'Home page — middle strip', size: '1600 × 400 px (4:1)' },
  { value: 'CATEGORY_TOP', label: 'Top of category pages', size: '1600 × 400 px (4:1)' },
];

function live(b: Banner): { label: string; tone: 'green' | 'gray' | 'amber' } {
  const now = Date.now();
  if (!b.isActive) return { label: 'Off', tone: 'gray' };
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'amber' };
  if (b.endsAt && new Date(b.endsAt).getTime() < now) return { label: 'Ended', tone: 'gray' };
  return { label: 'Showing', tone: 'green' };
}

export function BannersPage() {
  const toast = useToast();
  const list = useApi<Banner[]>('/admin/banners');
  const { busy, run } = useAction();
  const [form, setForm] = useState<Form | null>(null);
  const [del, setDel] = useState<Banner | null>(null);

  async function save() {
    if (!form) return;
    if (form.linkUrl && !/^(\/\S*|https:\/\/\S+)$/.test(form.linkUrl.trim())) return toast.error('Link must start with / (a page of the shop) or https://');
    const fields = {
      placement: form.placement,
      locale: form.locale || undefined,
      linkUrl: form.linkUrl.trim() || undefined,
      sortOrder: form.sortOrder ? Number(form.sortOrder) : 0,
      startsAt: fromQatarLocalInput(form.startsAt),
      endsAt: fromQatarLocalInput(form.endsAt),
      isActive: form.isActive,
      // text on the banner: empty clears it
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, form[k].trim()])),
    };
    if (form.id) {
      const r = await run('save', () => api(`/admin/banners/${form.id}`, { method: 'PATCH', body: fields }), 'Banner saved');
      if (r !== undefined) { setForm(null); list.reload(); }
      return;
    }
    if (!form.file) return toast.error('Choose the banner image');
    const fd = new FormData();
    fd.append('file', form.file);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') fd.append(k, String(v));
    const r = await run('save', () => api('/admin/banners', { method: 'POST', body: fd }), 'Banner added');
    if (r !== undefined) { setForm(null); list.reload(); }
  }

  async function remove() {
    if (!del) return;
    const r = await run('del', () => api(`/admin/banners/${del.id}`, { method: 'DELETE' }), 'Banner deleted');
    if (r !== undefined) { setDel(null); list.reload(); }
  }

  const blank = (placement = 'HOME_HERO'): Form => ({ placement, locale: '', linkUrl: '', sortOrder: '', startsAt: '', endsAt: '', isActive: true, file: null, ...noTexts() });

  return (
    <>
      <PageHeader title="Banners" description="Promotional images on the home page and category pages. Schedule them for campaigns." actions={<button type="button" className="btn-primary" onClick={() => setForm(blank())}><Plus className="size-4" aria-hidden /> Add banner</button>} />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <div className="space-y-6">
          {PLACEMENTS.map((p) => {
            const items = list.data!.filter((b) => b.placement === p.value).sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <Card key={p.value} title={p.label} description={`Recommended ${p.size}. Several banners rotate in this order.`} actions={<button type="button" className="btn-secondary btn-sm" onClick={() => setForm(blank(p.value))}><Plus className="size-4" aria-hidden /> Add</button>}>
                {items.length === 0 ? <EmptyState title="No banners here" /> : (
                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((b) => {
                      const s = live(b);
                      return (
                        <li key={b.id} className="overflow-hidden rounded-xl border border-ink-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={b.imageUrl} alt="" className="aspect-[8/3] w-full bg-ink-50 object-cover" />
                          <div className="flex items-start gap-2 p-3 text-sm">
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-1.5"><Badge tone={s.tone}>{s.label}</Badge>{b.locale ? <Badge>{b.locale === 'ar' ? 'Arabic only' : 'English only'}</Badge> : null}<span className="text-xs text-ink-500">#{b.sortOrder}</span></p>
                              {b.headline ? <p className="mt-1 truncate text-xs font-semibold text-ink-800" data-testid="banner-headline">{b.headline.replace(/\*/g, '').replace(/\n/g, ' · ')}</p> : null}
                              <p className="mt-1 truncate text-xs text-ink-600">{b.linkUrl ?? 'No link'}</p>
                              {b.startsAt || b.endsAt ? <p className="text-xs text-ink-500">{b.startsAt ? formatDate(b.startsAt) : '…'} – {b.endsAt ? formatDate(b.endsAt) : '…'}</p> : null}
                            </div>
                            <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => setForm({ id: b.id, placement: b.placement, locale: b.locale ?? '', linkUrl: b.linkUrl ?? '', sortOrder: String(b.sortOrder), startsAt: toQatarLocalInput(b.startsAt), endsAt: toQatarLocalInput(b.endsAt), isActive: b.isActive, file: null, ...textsOf(b) })} aria-label="Edit banner"><Pencil className="size-4" aria-hidden /></button>
                            <button type="button" className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => setDel(b)} aria-label="Delete banner"><Trash2 className="size-4" aria-hidden /></button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit banner' : 'Add banner'}
        description={form?.id ? 'To change the picture, add a new banner and delete this one.' : undefined}
        size="lg"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : null} Save</button></>}
      >
        {form ? (
          <div className="space-y-4">
            {!form.id ? (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 p-6 text-center text-sm text-ink-600 hover:bg-ink-25">
                {form.file ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={URL.createObjectURL(form.file)} alt="" className="max-h-40 rounded-lg object-contain" />
                ) : <ImagePlus className="size-7 text-ink-400" aria-hidden />}
                <span className="font-medium">{form.file ? form.file.name : 'Choose image (JPG, PNG or WebP, max 5 MB)'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const err = checkImageFile(f); if (err) toast.error(err); else setForm({ ...form, file: f }); }} />
              </label>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Where" value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })}>
                {PLACEMENTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </SelectField>
              <SelectField label="Language" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
                <option value="">Both (English and Arabic)</option>
                <option value="en">English site only</option>
                <option value="ar">Arabic site only</option>
              </SelectField>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <TextField label="Link" value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="/search?category=perfumes" hint="A page of the shop (starts with /) or an https:// address" />
              <TextField label="Order" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/\D/g, '') })} placeholder="0" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Show from (Qatar time)" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} hint="Empty = now" />
              <TextField label="Show until (Qatar time)" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} hint="Empty = no end" />
            </div>
            {form.placement === 'HOME_HERO' ? (
              <fieldset className="space-y-3 rounded-xl border border-ink-100 p-4">
                <legend className="px-1 text-sm font-semibold text-ink-800">Text on the banner (optional)</legend>
                <p className="text-xs text-ink-500">With a headline, the website draws the text on a purple background and puts your picture on the side — use a product photo with a transparent or dark background (PNG). Without a headline the picture is shown alone.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label="Small badge" value={form.kicker} maxLength={30} onChange={(e) => setForm({ ...form, kicker: e.target.value })} placeholder="Limited time" />
                  <TextField label="Small badge (Arabic)" dir="rtl" value={form.kickerAr} maxLength={30} onChange={(e) => setForm({ ...form, kickerAr: e.target.value })} placeholder="لفترة محدودة" />
                  <TextArea label="Headline" rows={2} value={form.headline} maxLength={80} onChange={(e) => setForm({ ...form, headline: e.target.value.split('\n').slice(0, 2).join('\n') })} placeholder={'Big deals\nUp to *50% off*'} hint="Two lines at most. Put *stars* around words to colour them purple." />
                  <TextArea label="Headline (Arabic)" dir="rtl" rows={2} value={form.headlineAr} maxLength={80} onChange={(e) => setForm({ ...form, headlineAr: e.target.value.split('\n').slice(0, 2).join('\n') })} placeholder={'عروض كبيرة\nخصم حتى *50%*'} />
                  <TextField label="Line under it" value={form.subline} maxLength={120} onChange={(e) => setForm({ ...form, subline: e.target.value })} placeholder="Top brands • Best prices • Qatar delivery" />
                  <TextField label="Line under it (Arabic)" dir="rtl" value={form.sublineAr} maxLength={120} onChange={(e) => setForm({ ...form, sublineAr: e.target.value })} placeholder="أفضل الماركات • أفضل الأسعار • توصيل في قطر" />
                  <TextField label="Button" value={form.ctaLabel} maxLength={24} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} placeholder="Shop now" hint="Shown when the banner has a link" />
                  <TextField label="Button (Arabic)" dir="rtl" value={form.ctaLabelAr} maxLength={24} onChange={(e) => setForm({ ...form, ctaLabelAr: e.target.value })} placeholder="تسوّق الآن" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextPreview f={form} ar={false} />
                  <TextPreview f={form} ar />
                </div>
              </fieldset>
            ) : null}
            <Switch checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} label="Active" />
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={remove} title="Delete this banner?" confirmLabel="Delete" danger busy={busy === 'del'} />
    </>
  );
}
