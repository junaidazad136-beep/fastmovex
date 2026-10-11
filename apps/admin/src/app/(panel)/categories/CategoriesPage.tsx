'use client';

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Card, ConfirmDialog, Dialog, ErrorState, Loading, PageHeader, SelectField, Spinner, Switch, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useAction, useApi } from '@/lib/use-api';
import { useConfig } from '@/components/layout/Providers';
import { EMPTY_SEO, type FaqRow, SeoEditor, seoBody, seoOf, type SeoValue } from '@/components/seo/SeoEditor';

interface Cat {
  id: string; parentId: string | null; slug: string; name: string; nameAr: string; depth: number; sortOrder: number; isActive: boolean; _count: { products: number; children: number };
  description?: string | null; descriptionAr?: string | null; seoTitle?: string | null; seoTitleAr?: string | null; seoDescription?: string | null; seoDescriptionAr?: string | null; faq?: FaqRow[];
}
interface Form { id?: string; name: string; nameAr: string; slug: string; parentId: string; isActive: boolean; seo: SeoValue; faq: FaqRow[] }

export function CategoriesPage() {
  const cats = useApi<Cat[]>('/admin/categories');
  const { busy, run } = useAction();
  const [form, setForm] = useState<Form | null>(null);
  const [del, setDel] = useState<Cat | null>(null);
  const [tab, setTab] = useState<'basics' | 'seo'>('basics');
  const { storefrontUrl } = useConfig();

  const byParent = useMemo(() => {
    const m = new Map<string | null, Cat[]>();
    for (const c of cats.data ?? []) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    for (const list of m.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return m;
  }, [cats.data]);

  const ordered = useMemo(() => {
    const out: Cat[] = [];
    const walk = (p: string | null) => (byParent.get(p) ?? []).forEach((c) => { out.push(c); walk(c.id); });
    walk(null);
    return out;
  }, [byParent]);

  async function move(c: Cat, dir: -1 | 1) {
    const siblings = [...(byParent.get(c.parentId) ?? [])];
    const i = siblings.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    const r = await run('move', () => api('/admin/categories/reorder', { method: 'PUT', body: { items: siblings.map((s, k) => ({ id: s.id, sortOrder: k })) } }));
    if (r !== undefined) cats.reload();
  }

  async function save() {
    if (!form) return;
    const faq = form.faq.filter((f) => f.q.trim() && f.a.trim() && f.qAr.trim() && f.aAr.trim()).map((f) => ({ q: f.q.trim(), qAr: f.qAr.trim(), a: f.a.trim(), aAr: f.aAr.trim() }));
    const body = { name: form.name.trim(), nameAr: form.nameAr.trim(), slug: form.slug.trim() || undefined, parentId: form.parentId || (form.id ? null : undefined), isActive: form.isActive, ...seoBody(form.seo), faq };
    const r = await run('save', () => api(form.id ? `/admin/categories/${form.id}` : '/admin/categories', { method: form.id ? 'PATCH' : 'POST', body }), form.id ? 'Category saved' : 'Category added');
    if (r !== undefined) {
      setForm(null);
      cats.reload();
    }
  }

  async function remove() {
    if (!del) return;
    const r = await run('delete', () => api(`/admin/categories/${del.id}`, { method: 'DELETE' }), 'Category deleted');
    if (r !== undefined) {
      setDel(null);
      cats.reload();
    }
  }

  // A category cannot become a child of itself or of one of its own subcategories.
  const invalidParents = useMemo(() => {
    const s = new Set<string>();
    if (!form?.id) return s;
    const walk = (id: string) => { s.add(id); (byParent.get(id) ?? []).forEach((c) => walk(c.id)); };
    walk(form.id);
    return s;
  }, [form?.id, byParent]);

  return (
    <>
      <PageHeader
        title="Categories"
        description="The shop menu and filters. Order here is the order customers see. Hidden categories keep their products but disappear from the menu."
        actions={<button type="button" className="btn-primary" onClick={() => { setTab('basics'); setForm({ name: '', nameAr: '', slug: '', parentId: '', isActive: true, seo: EMPTY_SEO, faq: [] }); }}><Plus className="size-4" aria-hidden /> Add category</button>}
      />
      {cats.error ? <ErrorState error={cats.error} onRetry={cats.reload} /> : !cats.data ? <Loading /> : (
        <Card bodyClassName="p-0">
          <ul className="divide-y divide-ink-100">
            {ordered.map((c) => {
              const siblings = byParent.get(c.parentId) ?? [];
              const idx = siblings.findIndex((s) => s.id === c.id);
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5" style={{ paddingInlineStart: `${16 + c.depth * 28}px` }}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {c.depth ? <span className="text-ink-300" aria-hidden>└</span> : null}
                      {c.name}
                      <span dir="rtl" lang="ar" className="font-normal text-ink-500">{c.nameAr}</span>
                      {!c.isActive ? <Badge>Hidden</Badge> : null}
                      {c.description || c.seoTitle ? <Badge tone="green">SEO text</Badge> : null}
                    </p>
                    <p className="text-xs text-ink-500">/{c.slug} · {c._count.products} products{c._count.children ? ` · ${c._count.children} subcategories` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={!!busy || idx === 0} onClick={() => move(c, -1)} aria-label={`Move ${c.name} up`}><ArrowUp className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={!!busy || idx === siblings.length - 1} onClick={() => move(c, 1)} aria-label={`Move ${c.name} down`}><ArrowDown className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => { setTab('basics'); setForm({ id: c.id, name: c.name, nameAr: c.nameAr, slug: c.slug, parentId: c.parentId ?? '', isActive: c.isActive, seo: seoOf(c), faq: c.faq ?? [] }); }} aria-label={`Edit ${c.name}`}><Pencil className="size-4" aria-hidden /></button>
                    <button type="button" className="rounded-md p-1.5 text-danger-600 hover:bg-danger-50 disabled:opacity-30" disabled={c._count.products > 0 || c._count.children > 0} title={c._count.products || c._count.children ? 'Move its products and subcategories first, or hide it' : 'Delete'} onClick={() => setDel(c)} aria-label={`Delete ${c.name}`}><Trash2 className="size-4" aria-hidden /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit category' : 'Add category'}
        size={tab === 'seo' ? 'xl' : 'md'}
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={save} disabled={busy === 'save' || !form?.name.trim() || !form?.nameAr.trim()}>{busy === 'save' ? <Spinner /> : null} Save</button></>}
      >
        {form ? (
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-ink-100" role="tablist">
              {(['basics', 'seo'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`} data-testid={`category-tab-${k}`}>
                  {k === 'basics' ? 'Basics' : 'Google (SEO)'}
                </button>
              ))}
            </div>
            {tab === 'seo' ? (
              <SeoEditor kind="category" value={form.seo} onChange={(seo) => setForm({ ...form, seo })} name={form.name} nameAr={form.nameAr} url={`${storefrontUrl.replace(/^https?:\/\//, '')}/en/c/${form.slug || '…'}`} faq={form.faq} onFaqChange={(faq) => setForm({ ...form, faq })} />
            ) : (<>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Name (English)" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoFocus />
              <TextField label="Name (Arabic)" required dir="rtl" lang="ar" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} maxLength={80} />
            </div>
            <TextField label="Web address" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="made from the name" hint="Changing it breaks old links to this category." />
            <SelectField label="Parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">None (top level)</option>
              {ordered.filter((c) => !invalidParents.has(c.id)).map((c) => <option key={c.id} value={c.id}>{'  '.repeat(c.depth * 2)}{c.name}</option>)}
            </SelectField>
            <Switch checked={form.isActive} onChange={(isActive) => setForm({ ...form, isActive })} label="Show in the shop" />
            </>)}
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={remove} title={`Delete ${del?.name ?? ''}?`} description="This cannot be undone." confirmLabel="Delete" danger busy={busy === 'delete'} />
    </>
  );
}
