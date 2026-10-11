'use client';

import { ExternalLink, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useConfig } from '@/components/layout/Providers';
import { EMPTY_SEO, SeoEditor, seoBody, seoOf, type SeoValue } from '@/components/seo/SeoEditor';
import { Badge, Card, Dialog, EmptyState, ErrorState, PageHeader, SearchInput, SkeletonRows, Spinner, Table, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useAction, useApi } from '@/lib/use-api';

interface BrandRow {
  id: string; name: string; nameAr: string | null; slug: string; _count: { products: number };
  description: string | null; descriptionAr: string | null; seoTitle: string | null; seoTitleAr: string | null; seoDescription: string | null; seoDescriptionAr: string | null;
}

export function BrandsPage() {
  const [q, setQ] = useState('');
  const brands = useApi<BrandRow[]>(`/admin/brands${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [form, setForm] = useState<{ id?: string; name: string; nameAr: string; slug: string; seo: SeoValue } | null>(null);
  const { busy, run } = useAction();
  const { storefrontUrl } = useConfig();

  async function save() {
    if (!form) return;
    const r = await run('save', () => api(form.id ? `/admin/brands/${form.id}` : '/admin/brands', { method: form.id ? 'PATCH' : 'POST', body: { name: form.name.trim(), nameAr: form.nameAr.trim() || null, slug: form.slug.trim() || undefined, ...seoBody(form.seo) } }), form.id ? 'Brand saved' : 'Brand added');
    if (r !== undefined) {
      setForm(null);
      brands.reload();
    }
  }

  return (
    <>
      <PageHeader title="Brands" description="Used on product pages, in the brand filter, and each brand with products gets its own page on the website (found on Google for “<brand> Qatar”)." actions={<button type="button" className="btn-primary" onClick={() => setForm({ name: '', nameAr: '', slug: '', seo: EMPTY_SEO })}><Plus className="size-4" aria-hidden /> Add brand</button>} />
      <Card bodyClassName="p-0">
        <div className="border-b border-ink-100 p-3"><SearchInput value={q} onChange={setQ} placeholder="Search brands" /></div>
        {brands.error ? <ErrorState error={brands.error} onRetry={brands.reload} /> : (
          <Table>
            <thead><tr><th className="th">Brand</th><th className="th">Page</th><th className="th text-end">Products</th><th className="th">Google text</th><th className="th w-10"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>
              {!brands.data ? <SkeletonRows cols={5} /> : null}
              {brands.data?.map((b) => (
                <tr key={b.id} className="hover:bg-ink-25" data-testid="brand-row">
                  <td className="td font-medium">{b.name}{b.nameAr ? <span className="ms-2 font-normal text-ink-500"><bdi dir="rtl" lang="ar">{b.nameAr}</bdi></span> : null}</td>
                  <td className="td text-ink-500">{b._count.products ? <a className="inline-flex items-center gap-1 hover:text-brand-700" href={`${storefrontUrl}/en/brand/${b.slug}`} target="_blank" rel="noopener noreferrer">/brand/{b.slug}<ExternalLink className="size-3" aria-hidden /></a> : `/brand/${b.slug}`}</td>
                  <td className="td text-end tabular">{b._count.products}</td>
                  <td className="td">{b.description || b.seoTitle ? <Badge tone="green">Written</Badge> : b._count.products ? <Badge tone="amber">Missing</Badge> : null}</td>
                  <td className="td"><button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" onClick={() => setForm({ id: b.id, name: b.name, nameAr: b.nameAr ?? '', slug: b.slug, seo: seoOf(b) })} aria-label={`Edit ${b.name}`}><Pencil className="size-4" aria-hidden /></button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {brands.data?.length === 0 ? <EmptyState title="No brands found" /> : null}
        {brands.data?.length === 500 ? <p className="p-3 text-center text-xs text-ink-500">Showing the first 500. Search to find others.</p> : null}
      </Card>
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit brand' : 'Add brand'}
        size="xl"
        footer={<><button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn-primary" onClick={save} disabled={busy === 'save' || !form?.name.trim()}>{busy === 'save' ? <Spinner /> : null} Save</button></>}
      >
        {form ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoFocus />
              <TextField label="Name in Arabic" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} maxLength={80} dir="rtl" lang="ar" />
              <TextField label="Web address" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="made from the name" />
            </div>
            <SeoEditor kind="brand" value={form.seo} onChange={(seo) => setForm({ ...form, seo })} name={form.name} nameAr={form.nameAr} url={`${storefrontUrl.replace(/^https?:\/\//, '')}/en/brand/${form.slug || '…'}`} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
