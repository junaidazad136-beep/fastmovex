'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Layers, Pencil, Plus, RotateCcw, Trash2, User } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useConfig } from '@/components/layout/Providers';
import { Badge, Card, ConfirmDialog, Dialog, ErrorState, Loading, PageHeader, SearchInput, SelectField, Spinner, TextField, Thumb } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import type { NumberedPage } from '@/lib/api/types';
import { categoryOptionLabel, useCategoryOptions } from '@/lib/catalog';
import { formatMoney } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { useApi } from '@/lib/use-api';
import type { ProductRow } from '../products/ProductsList';

type Source = 'category' | 'tag' | 'products' | 'sale';
interface CollectionConfig { source: Source; categoryId?: string; tag?: string; productIds?: string[]; sort?: string; limit?: number }
interface Row { uid: string; key: string; title: string; titleAr: string; config: CollectionConfig | Record<string, never>; isActive: boolean }
interface Builtin { key: string; label: string; description: string; personal?: boolean }
interface Layout { countryCode: string; custom: boolean; sections: { id: string | null; key: string; title: string | null; titleAr: string | null; config: unknown; isActive: boolean }[]; builtins: Builtin[] }
interface PreviewCard { id: string; title: string; imageUrl: string | null; priceMinor: string; currencyCode: string }

const SOURCES: { value: Source; label: string; hint: string }[] = [
  { value: 'category', label: 'A category', hint: 'Best products of a category (and its subcategories)' },
  { value: 'tag', label: 'Products with a tag', hint: 'e.g. “eid”, “gift”, “summer” — set tags in the product editor' },
  { value: 'products', label: 'Products I choose', hint: 'Pick up to 24 products, shown in your order' },
  { value: 'sale', label: 'Products on sale', hint: 'Biggest discounts first (price below the “compare-at” price)' },
];
const SORTS = [
  { value: 'popular', label: 'Best selling' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

let seq = 0;
const uid = () => `r${++seq}`;

function toRows(l: Layout): Row[] {
  return l.sections.map((s) => ({ uid: uid(), key: s.key, title: s.title ?? '', titleAr: s.titleAr ?? '', config: (s.config ?? {}) as Row['config'], isActive: s.isActive }));
}

/** The website's home page, top to bottom: order, show/hide, rename built-in sections, and add product collections. */
export function HomePageEditor() {
  const toast = useToast();
  const { storefrontUrl, country } = useConfig();
  const layout = useApi<Layout>(`/admin/home-sections?country=${country}`);
  const categories = useCategoryOptions();
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (layout.data) {
      const r = toRows(layout.data);
      setRows(r);
      setSaved(JSON.stringify(r.map(({ uid: _u, ...x }) => x)));
    }
  }, [layout.data]);

  const builtins = layout.data?.builtins ?? [];
  const meta = (key: string) => builtins.find((b) => b.key === key);
  const missing = useMemo(() => builtins.filter((b) => !rows.some((r) => r.key === b.key)), [builtins, rows]);
  const dirty = JSON.stringify(rows.map(({ uid: _u, ...x }) => x)) !== saved;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (layout.error) return <ErrorState error={layout.error} onRetry={layout.reload} />;
  if (!layout.data) return <Loading />;

  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const n = [...r];
    const j = i + d;
    if (j < 0 || j >= n.length) return r;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const patch = (u: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.uid === u ? { ...x, ...p } : x)));

  async function save() {
    setBusy('save');
    try {
      const res = await api<Layout>('/admin/home-sections', {
        method: 'PUT',
        body: { countryCode: country, sections: rows.map((r) => ({ key: r.key, title: r.title.trim() || null, titleAr: r.titleAr.trim() || null, config: r.key === 'collection' ? r.config : undefined, isActive: r.isActive })) },
      });
      layout.setData(res);
      toast.success('Home page saved. The website shows it within a minute.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    try {
      layout.setData(await api<Layout>('/admin/home-sections/reset', { method: 'POST', body: { countryCode: country } }));
      toast.success('Back to the standard home page');
      setResetOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function describe(r: Row): string {
    if (r.key !== 'collection') return meta(r.key)?.description ?? '';
    const c = r.config as CollectionConfig;
    const sort = SORTS.find((s) => s.value === (c.sort ?? 'popular'))?.label.toLowerCase();
    if (c.source === 'category') return `Category: ${categories?.find((x) => x.id === c.categoryId)?.label ?? '…'} · ${sort}`;
    if (c.source === 'tag') return `Tag “${c.tag}” · ${sort}`;
    if (c.source === 'products') return `${c.productIds?.length ?? 0} chosen products`;
    return 'Products on sale, biggest discount first';
  }

  return (
    <>
      <PageHeader
        title="Home page"
        description="What shoppers see on the home page, from top to bottom. Empty sections (e.g. no live flash sale) are skipped automatically."
        actions={
          <>
            <a href={`${storefrontUrl}/en`} target="_blank" rel="noopener noreferrer" className="btn-secondary">View home page <ExternalLink className="size-3.5" aria-hidden /></a>
            {layout.data.custom ? <button type="button" className="btn-ghost" onClick={() => setResetOpen(true)}><RotateCcw className="size-4" aria-hidden /> Standard layout</button> : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Sections" description={layout.data.custom ? undefined : 'This is the standard layout. Change anything and save to make it yours.'} className="xl:col-span-2" bodyClassName="p-0">
          <ol className="divide-y divide-ink-100">
            {rows.map((r, i) => {
              const m = meta(r.key);
              const collection = r.key === 'collection';
              return (
                <li key={r.uid} className={clsx('flex items-center gap-3 px-4 py-3', !r.isActive && 'bg-ink-25 opacity-60')}>
                  <span className="w-6 text-center text-xs font-semibold text-ink-400 tabular">{i + 1}</span>
                  <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-lg', collection ? 'bg-sand-100 text-sand-700' : 'bg-ink-100 text-ink-500')}>
                    {m?.personal ? <User className="size-4" aria-hidden /> : <Layers className="size-4" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                      {r.title || (collection ? 'Collection' : m?.label ?? r.key)}
                      {r.title && !collection ? <span className="text-xs font-normal text-ink-400">({m?.label})</span> : null}
                      {collection ? <Badge tone="brand">Collection</Badge> : null}
                      {m?.personal ? <Badge tone="blue">Per shopper</Badge> : null}
                      {!r.isActive ? <Badge>Hidden</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-ink-500">{describe(r)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${r.title || m?.label || 'section'} up`}><ArrowUp className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${r.title || m?.label || 'section'} down`}><ArrowDown className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => patch(r.uid, { isActive: !r.isActive })} aria-label={r.isActive ? 'Hide section' : 'Show section'} title={r.isActive ? 'Hide' : 'Show'}>
                      {r.isActive ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                    </button>
                    {r.key !== 'value_props' ? <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => setEditing(r)} aria-label="Edit section"><Pencil className="size-4" aria-hidden /></button> : <span className="w-7" />}
                    <button type="button" className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50" onClick={() => setRows((x) => x.filter((y) => y.uid !== r.uid))} aria-label="Remove section"><Trash2 className="size-4" aria-hidden /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 p-4">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing({ uid: uid(), key: 'collection', title: '', titleAr: '', config: { source: 'category', sort: 'popular', limit: 12 }, isActive: true })}>
              <Plus className="size-4" aria-hidden /> Add collection
            </button>
            {missing.length > 0 ? (
              <select
                className="input w-auto py-1.5 text-xs"
                value=""
                onChange={(e) => { if (e.target.value) setRows((r) => [...r, { uid: uid(), key: e.target.value, title: '', titleAr: '', config: {}, isActive: true }]); }}
                aria-label="Add back a standard section"
              >
                <option value="">Add a standard section…</option>
                {missing.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            ) : null}
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Tips">
            <ul className="list-disc space-y-2 ps-5 text-sm text-ink-600">
              <li>Keep the main banners first: they are the first thing people see on a phone.</li>
              <li>Use <strong>collections</strong> for seasons and events — “Ramadan essentials”, “National Day”, “Back to school” — then hide or remove them after.</li>
              <li>Sections marked <strong>Per shopper</strong> only appear for signed-in shoppers (or in the app).</li>
              <li>Banner pictures are managed in <a href="/banners" className="link">Banners</a>; flash-sale products in <a href="/campaigns" className="link">Flash sales</a>.</li>
            </ul>
          </Card>
        </div>
      </div>

      {dirty ? (
        <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <span className="me-auto text-sm text-ink-500">Unsaved changes</span>
          <button type="button" className="btn-ghost" onClick={() => layout.data && setRows(toRows(layout.data))}>Discard</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : null} Save home page</button>
        </div>
      ) : null}

      <SectionDialog
        row={editing}
        builtin={editing ? meta(editing.key) : undefined}
        onClose={() => setEditing(null)}
        onDone={(r) => {
          setRows((x) => (x.some((y) => y.uid === r.uid) ? x.map((y) => (y.uid === r.uid ? r : y)) : [...x.slice(0, 1), r, ...x.slice(1)]));
          setEditing(null);
        }}
        categories={categories?.map((c) => ({ id: c.id, label: categoryOptionLabel(c) })) ?? []}
      />
      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={reset} title="Use the standard layout?" description="Your order, titles and collections are removed and the standard home page comes back." confirmLabel="Use standard layout" danger busy={busy === 'reset'} />
    </>
  );
}

function SectionDialog({ row, builtin, onClose, onDone, categories }: { row: Row | null; builtin?: Builtin; onClose: () => void; onDone: (r: Row) => void; categories: { id: string; label: string }[] }) {
  const toast = useToast();
  const [r, setR] = useState<Row | null>(row);
  const [preview, setPreview] = useState<PreviewCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, ProductRow>>({});
  useEffect(() => { setR(row); setPreview(null); setQ(''); }, [row]);
  const search = useApi<NumberedPage<ProductRow>>(r?.key === 'collection' && (r.config as CollectionConfig).source === 'products' && q.trim().length >= 2 ? `/admin/products?status=ACTIVE&limit=8&q=${encodeURIComponent(q.trim())}` : null);

  if (!r) return <Dialog open={false} onClose={onClose} title="" />;
  const collection = r.key === 'collection';
  const c = r.config as CollectionConfig;
  const setC = (p: Partial<CollectionConfig>) => { setR({ ...r, config: { ...c, ...p } }); setPreview(null); };
  const ids = c.productIds ?? [];

  async function runPreview() {
    setLoading(true);
    try {
      const res = await api<{ items: PreviewCard[] }>('/admin/home-sections/preview', { method: 'POST', body: { config: c } });
      setPreview(res.items);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function done() {
    if (!r) return;
    if (collection) {
      if (!r.title.trim()) return toast.error('Give the collection a title');
      if (c.source === 'category' && !c.categoryId) return toast.error('Choose a category');
      if (c.source === 'tag' && !c.tag?.trim()) return toast.error('Enter a tag');
      if (c.source === 'products' && !ids.length) return toast.error('Choose at least one product');
    }
    onDone(r);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={collection ? (row?.title ? 'Edit collection' : 'New collection') : `Edit “${builtin?.label ?? r.key}”`}
      description={collection ? 'A row of products on the home page, updated automatically.' : 'Leave the titles empty to use the standard title.'}
      size="lg"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={done}>Done</button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Title (English)" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} maxLength={80} placeholder={collection ? 'e.g. Ramadan essentials' : builtin?.label} autoFocus />
          <TextField label="Title (Arabic)" dir="rtl" lang="ar" value={r.titleAr} onChange={(e) => setR({ ...r, titleAr: e.target.value })} maxLength={80} placeholder={collection ? 'مثال: مستلزمات رمضان' : undefined} />
        </div>
        {collection ? (
          <>
            <fieldset>
              <legend className="label">Show</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SOURCES.map((s) => (
                  <label key={s.value} className={clsx('flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm', c.source === s.value ? 'border-brand-600 bg-brand-50/50' : 'border-ink-200 hover:border-ink-300')}>
                    <input type="radio" name="source" className="mt-0.5 accent-brand-600" checked={c.source === s.value} onChange={() => setC({ source: s.value })} />
                    <span><span className="block font-medium">{s.label}</span><span className="block text-xs text-ink-500">{s.hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {c.source === 'category' ? (
              <SelectField label="Category" value={c.categoryId ?? ''} onChange={(e) => setC({ categoryId: e.target.value || undefined })}>
                <option value="">Choose…</option>
                {categories.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </SelectField>
            ) : null}
            {c.source === 'tag' ? <TextField label="Tag" value={c.tag ?? ''} onChange={(e) => setC({ tag: e.target.value.toLowerCase() })} maxLength={40} placeholder="e.g. eid" /> : null}
            {c.source === 'products' ? (
              <div className="space-y-3">
                <SearchInput value={q} onChange={setQ} placeholder="Search products to add" />
                {search.data?.items.length ? (
                  <ul className="max-h-56 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100">
                    {search.data.items.map((p) => (
                      <li key={p.id}>
                        <button type="button" disabled={ids.includes(p.id) || ids.length >= 24} onClick={() => { setPicked({ ...picked, [p.id]: p }); setC({ productIds: [...ids, p.id] }); }} className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-ink-50 disabled:opacity-50">
                          <Thumb src={p.imageUrl} alt="" size={32} /><span className="flex-1 truncate">{p.title}</span><span className="text-xs text-ink-500">{ids.includes(p.id) ? 'Added' : 'Add'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs text-ink-500">{ids.length} of 24 chosen{ids.length ? ' — shown in this order' : ''}</p>
                {ids.length ? (
                  <ol className="space-y-1">
                    {ids.map((id, i) => (
                      <li key={id} className="flex items-center gap-2 rounded-lg bg-ink-25 px-2 py-1.5 text-sm">
                        <span className="w-5 text-xs text-ink-400">{i + 1}</span>
                        <span className="flex-1 truncate">{picked[id]?.title ?? preview?.find((p) => p.id === id)?.title ?? `Product ${id.slice(0, 8)}`}</span>
                        <button type="button" className="rounded p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30" disabled={i === 0} onClick={() => { const n = [...ids]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setC({ productIds: n }); }} aria-label="Move up"><ArrowUp className="size-3.5" aria-hidden /></button>
                        <button type="button" className="rounded p-1 text-danger-600 hover:bg-danger-50" onClick={() => setC({ productIds: ids.filter((x) => x !== id) })} aria-label="Remove"><Trash2 className="size-3.5" aria-hidden /></button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {c.source !== 'products' && c.source !== 'sale' ? (
                <SelectField label="Order" value={c.sort ?? 'popular'} onChange={(e) => setC({ sort: e.target.value })}>
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </SelectField>
              ) : null}
              <SelectField label="How many products" value={String(c.limit ?? 12)} onChange={(e) => setC({ limit: Number(e.target.value) })}>
                {[6, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{n}</option>)}
              </SelectField>
            </div>
            <div>
              <button type="button" className="btn-secondary btn-sm" onClick={runPreview} disabled={loading}>{loading ? <Spinner /> : <Eye className="size-4" aria-hidden />} Preview</button>
              {preview ? (
                preview.length === 0 ? (
                  <p className="mt-2 text-sm text-warning-600">Nothing to show right now (no live, in-stock products match). The section stays hidden until there are.</p>
                ) : (
                  <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {preview.map((p) => (
                      <li key={p.id} className="text-xs">
                        <Thumb src={p.imageUrl} alt="" size={80} />
                        <p className="mt-1 line-clamp-2">{p.title}</p>
                        <p className="font-medium tabular">{formatMoney(p.priceMinor, p.currencyCode, { compact: true })}</p>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
