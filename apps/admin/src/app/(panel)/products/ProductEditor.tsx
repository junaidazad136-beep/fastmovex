'use client';

import { Archive, Check, ExternalLink, Eye, Star, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { useConfig } from '@/components/layout/Providers';
import { ImagesManager, PendingImages, uploadImage, type ProductImage } from '@/components/products/ImagesManager';
import { SpecsEditor, rowsToSpecs, specsToRows, type SpecRow } from '@/components/products/SpecsEditor';
import { TagsInput } from '@/components/products/TagsInput';
import { VariantsBuilder, emptyVariant, toVariantInputs, type DraftOption, type DraftVariant } from '@/components/products/VariantsBuilder';
import { VariantsManager, type SavedVariant } from '@/components/products/VariantsManager';
import { Badge, Card, ConfirmDialog, Field, PageHeader, SelectField, Spinner, StatusBadge, Switch, TextArea, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import type { Brand } from '@/lib/api/types';
import { categoryOptionLabel, useBrands, useCategoryOptions } from '@/lib/catalog';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useApi } from '@/lib/use-api';

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  titleAr: string | null;
  shortDescription: string | null;
  shortDescriptionAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  /** fields the shop translated automatically; a field edited by hand leaves this list */
  autoText?: Record<string, { text: string }>;
  /** Arabic for option words ("Colour" → "اللون") */
  optionsAr?: Record<string, string> | null;
  specs: Record<string, string> | null;
  tags: string[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: string;
  moderationNote: string | null;
  returnPolicyDays: number | null;
  warrantyMonths: number | null;
  sizeChartId?: string | null;
  isFeatured: boolean;
  tracksExpiry?: boolean;
  soldCount: number;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  categoryId: string;
  brandId: string | null;
  category: { id: string; name: string } | null;
  brand: Brand | null;
  store: { id: string; name: string; slug: string; isHouse: boolean; sellerStatus: string };
  images: ProductImage[];
  variants: SavedVariant[];
}

interface Fields {
  title: string;
  titleAr: string;
  shortDescription: string;
  shortDescriptionAr: string;
  description: string;
  descriptionAr: string;
  categoryId: string;
  brandId: string;
  tags: string[];
  specs: SpecRow[];
  returnPolicyDays: string;
  warrantyMonths: string;
  sizeChartId: string;
  tracksExpiry: boolean;
  seoTitle: string;
  seoDescription: string;
}

function fieldsOf(p: ProductDetail | null): Fields {
  return {
    title: p?.title ?? '',
    titleAr: p?.titleAr ?? '',
    shortDescription: p?.shortDescription ?? '',
    shortDescriptionAr: p?.shortDescriptionAr ?? '',
    description: p?.description ?? '',
    descriptionAr: p?.descriptionAr ?? '',
    categoryId: p?.categoryId ?? '',
    brandId: p?.brandId ?? '',
    tags: p?.tags ?? [],
    specs: specsToRows(p?.specs),
    returnPolicyDays: p?.returnPolicyDays != null ? String(p.returnPolicyDays) : '',
    warrantyMonths: p?.warrantyMonths != null ? String(p.warrantyMonths) : '',
    tracksExpiry: !!p?.tracksExpiry,
    sizeChartId: p?.sizeChartId ?? '',
    seoTitle: p?.seoTitle ?? '',
    seoDescription: p?.seoDescription ?? '',
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);
const intOrNull = (s: string) => (s.trim() ? Number.parseInt(s, 10) : null);

/** The editable fields as the API wants them. Empty optional fields are sent as null so they are cleared. */
function payload(f: Fields, create: boolean) {
  const body = {
    title: f.title.trim(),
    titleAr: orNull(f.titleAr),
    shortDescription: orNull(f.shortDescription),
    shortDescriptionAr: orNull(f.shortDescriptionAr),
    description: orNull(f.description),
    descriptionAr: orNull(f.descriptionAr),
    categoryId: f.categoryId,
    brandId: f.brandId || null,
    tags: f.tags,
    specs: rowsToSpecs(f.specs),
    returnPolicyDays: intOrNull(f.returnPolicyDays),
    warrantyMonths: intOrNull(f.warrantyMonths),
    tracksExpiry: f.tracksExpiry,
    sizeChartId: f.sizeChartId || null,
    seoTitle: orNull(f.seoTitle),
    seoDescription: orNull(f.seoDescription),
  };
  // A new product has nothing to clear: leave empty fields out rather than sending nulls.
  return create ? Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)) : body;
}

export function ProductEditor({ product, onReload }: { product: ProductDetail | null; onReload?: () => void }) {
  const create = !product;
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const { storefrontUrl } = useConfig();
  const categories = useCategoryOptions();
  const [brandQuery] = useState('');
  const brands = useBrands(brandQuery);
  const canEdit = can('products.manage');
  const sizeCharts = useApi<{ id: string; name: string }[]>('/admin/size-charts');

  const [f, setF] = useState<Fields>(() => fieldsOf(product));
  const [saved, setSaved] = useState<Fields>(() => fieldsOf(product));
  const [images, setImages] = useState<ProductImage[]>(product?.images ?? []);
  const [pending, setPending] = useState<File[]>([]);
  const [hasOptions, setHasOptions] = useState(false);
  const [options, setOptions] = useState<DraftOption[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([emptyVariant()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'reject' | null>(null);
  const [newBrand, setNewBrand] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      const next = fieldsOf(product);
      setF(next);
      setSaved(next);
      setImages(product.images);
    }
  }, [product]);

  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(saved), [f, saved]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty && pending.length === 0) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, pending.length]);

  const set = (p: Partial<Fields>) => setF((x) => ({ ...x, ...p }));
  /** "Auto" next to a field the machine translated (see Catalogue → Arabic translation) */
  const machine = product?.autoText ?? {};
  const auto = (k: string) => (machine[k] ? <Badge tone="blue" className="ms-2 align-middle">Auto</Badge> : null);
  const arHint = (k: keyof Fields) => (machine[k] ? 'Written automatically from the English. Edit it and your text is kept.' : String(f[k] ?? '').trim() ? undefined : 'Leave empty: it is written automatically from the English when you save.');

  function validate(): string | null {
    if (f.title.trim().length < 3) return 'Title must be at least 3 characters.';
    if (!f.categoryId) return 'Choose a category.';
    if (f.returnPolicyDays && Number(f.returnPolicyDays) > 90) return 'Return window can be at most 90 days.';
    if (f.warrantyMonths && Number(f.warrantyMonths) > 120) return 'Warranty can be at most 120 months.';
    return null;
  }

  async function submit(e: FormEvent, publish = false) {
    e.preventDefault();
    setError(null);
    const problem = validate();
    if (problem) return setError(problem);

    if (create) {
      const v = toVariantInputs(variants);
      if (!v.ok) return setError(v.error);
      if (publish && pending.length === 0) return setError('Add at least one photo to publish, or save as a draft.');
      setBusy(publish ? 'publish' : 'save');
      try {
        const created = await api<ProductDetail>('/admin/products', { method: 'POST', body: { ...payload(f, true), variants: v.value, status: 'DRAFT' } });
        let uploaded = 0;
        for (const file of pending) {
          try {
            await uploadImage(created.id, file);
            uploaded++;
          } catch (err) {
            toast.error(`${file.name}: ${errorMessage(err)}`);
          }
        }
        setPending([]);
        if (publish && uploaded > 0) {
          try {
            await api(`/admin/products/${created.id}/status`, { method: 'POST', body: { status: 'ACTIVE' } });
            toast.success('Product published');
          } catch (err) {
            toast.error(`Saved as a draft: ${errorMessage(err)}`);
          }
        } else toast.success('Product saved as a draft');
        setSaved(f);
        summaryStale();
        router.replace(`/products/${created.id}`);
      } catch (err) {
        setError(errorMessage(err));
        setBusy(null);
      }
      return;
    }

    setBusy('save');
    try {
      await api(`/admin/products/${product.id}`, { method: 'PATCH', body: payload(f, false) });
      setSaved(f);
      toast.success('Changes saved');
      onReload?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function action(key: string, path: string, body: unknown, success: string) {
    if (!product) return;
    setBusy(key);
    try {
      await api(path, { method: 'POST', body });
      toast.success(success);
      summaryStale();
      onReload?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  async function createBrand(name: string) {
    try {
      const b = await api<Brand>('/admin/brands', { method: 'POST', body: { name } });
      brands.setData((list) => [...(list ?? []), b].sort((a, c) => a.name.localeCompare(c.name)));
      set({ brandId: b.id });
      toast.success(`Brand "${b.name}" added`);
      setNewBrand(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const status = product?.status ?? 'DRAFT';
  const live = status === 'ACTIVE';
  const brandList = brands.data ?? [];
  const brandMissing = product?.brand && !brandList.some((b) => b.id === product.brand!.id);

  return (
    <form onSubmit={(e) => submit(e)} noValidate>
      <PageHeader
        back={{ href: '/products', label: 'Products' }}
        title={create ? 'Add product' : product.title}
        description={
          product ? (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status} />
              {product.isFeatured ? <Badge tone="brand"><Star className="size-3" aria-hidden /> Featured</Badge> : null}
              {!product.store.isHouse ? <Badge tone="violet">{product.store.name}</Badge> : null}
              <span>Updated {formatDateTime(product.updatedAt)}</span>
            </span>
          ) : undefined
        }
        actions={
          product ? (
            <>
              {live ? (
                <a href={`${storefrontUrl}/en/p/${product.slug}`} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                  <Eye className="size-4" aria-hidden /> View in store <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </>
          ) : null
        }
      />

      {product?.status === 'PENDING_REVIEW' ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning-600/20 bg-warning-50 px-4 py-3 text-sm">
          <p className="flex-1 text-warning-600">This product is waiting for approval before it appears in the store.</p>
          {can('products.moderate') ? (
            <>
              <button type="button" className="btn-danger btn-sm" onClick={() => setConfirm('reject')} disabled={!!busy}><X className="size-4" aria-hidden /> Reject</button>
              <button type="button" className="btn-primary btn-sm" onClick={() => action('approve', `/admin/products/${product.id}/approve`, undefined, 'Product approved and live')} disabled={!!busy}>
                <Check className="size-4" aria-hidden /> Approve
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {product?.moderationNote && product.status === 'REJECTED' ? (
        <p className="mb-6 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-600">Rejected: {product.moderationNote}</p>
      ) : null}

      {error ? <p className="mb-4 rounded-xl bg-danger-50 px-4 py-3 text-sm font-medium text-danger-600" role="alert">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <fieldset disabled={!canEdit} className="contents">
<Card title="Product details">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <TextField label={<>Title (English){auto("title")}</>} required value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} placeholder="e.g. Stainless Steel Kettle 1.7 L" />
                <TextField label={<>Title (Arabic){auto("titleAr")}</>} dir="rtl" lang="ar" value={f.titleAr} onChange={(e) => set({ titleAr: e.target.value })} maxLength={200} hint={arHint("titleAr")} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField label={<>Short description (English){auto("shortDescription")}</>} value={f.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} maxLength={300} hint="One line near the price" />
                <TextField label={<>Short description (Arabic){auto("shortDescriptionAr")}</>} dir="rtl" lang="ar" value={f.shortDescriptionAr} onChange={(e) => set({ shortDescriptionAr: e.target.value })} maxLength={300} hint={arHint("shortDescriptionAr")} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <TextArea label={<>Description (English){auto("description")}</>} value={f.description} onChange={(e) => set({ description: e.target.value })} rows={8} maxLength={10000} hint="Plain text. Blank lines start a new paragraph." />
                <TextArea label={<>Description (Arabic){auto("descriptionAr")}</>} dir="rtl" lang="ar" value={f.descriptionAr} onChange={(e) => set({ descriptionAr: e.target.value })} rows={8} maxLength={10000} hint={arHint("descriptionAr")} />
              </div>
            </div>
          </Card>
</fieldset>

          <Card title="Photos" description="JPG, PNG or WebP up to 5 MB, max 10. The first photo is the main one; square photos look best. With colours, set which colour each photo shows: the shop puts it on that colour’s card.">
            {product ? (
              <ImagesManager productId={product.id} images={images} onChange={setImages} canEdit={canEdit} variants={product.variants} />
            ) : (
              <PendingImages files={pending} onChange={setPending} />
            )}
          </Card>

          <Card title={create ? 'Price, stock and variants' : 'Variants, prices and stock'}>
            {product ? (
              <VariantsManager productId={product.id} productTitle={product.title} variants={product.variants} onChanged={() => onReload?.()} canEdit={canEdit} canStock={can('inventory.manage')} />
            ) : (
              <VariantsBuilder hasOptions={hasOptions} setHasOptions={setHasOptions} options={options} setOptions={setOptions} variants={variants} setVariants={setVariants} />
            )}
          </Card>

          <fieldset disabled={!canEdit} className="contents">
<Card title="Specifications" description="Shown as a table on the product page">
            <SpecsEditor rows={f.specs} onChange={(specs) => set({ specs })} />
          </Card>
</fieldset>

          <fieldset disabled={!canEdit} className="contents">
<Card title="Search engine listing" description="How the product can appear on Google. Empty fields use the title and description.">
            <div className="space-y-4">
              <TextField label="Page title" value={f.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} maxLength={70} hint={`${f.seoTitle.length}/70`} />
              <TextArea label="Meta description" value={f.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} maxLength={170} rows={3} hint={`${f.seoDescription.length}/170`} />
              <div className="rounded-lg border border-ink-100 bg-ink-25 p-3">
                <p className="truncate text-xs text-success-700">{storefrontUrl.replace(/^https?:\/\//, '')} › p › {product?.slug ?? 'new-product'}</p>
                <p className="truncate text-base text-[#1a0dab]">{f.seoTitle || f.title || 'Product title'} | FastMoveX</p>
                <p className="line-clamp-2 text-sm text-ink-600">{f.seoDescription || f.shortDescription || f.description || 'Product description'}</p>
              </div>
            </div>
          </Card>
</fieldset>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {product ? (
            <Card title="Status">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <StatusBadge status={status} />
                  <span className="text-xs text-ink-500">{product.soldCount} sold · {product.viewCount} views</span>
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    {status !== 'ACTIVE' && status !== 'PENDING_REVIEW' ? (
                      <button type="button" className="btn-primary btn-sm" disabled={!!busy || dirty} onClick={() => action('publish', `/admin/products/${product.id}/status`, { status: 'ACTIVE' }, 'Product is live')} title={dirty ? 'Save your changes first' : undefined}>
                        {busy === 'publish' ? <Spinner /> : null} Publish
                      </button>
                    ) : null}
                    {status === 'ACTIVE' ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => action('draft', `/admin/products/${product.id}/status`, { status: 'DRAFT' }, 'Product hidden (draft)')}>
                        Unpublish
                      </button>
                    ) : null}
                    {status !== 'ARCHIVED' ? (
                      <button type="button" className="btn-danger btn-sm" disabled={!!busy} onClick={() => setConfirm('archive')}>
                        <Archive className="size-4" aria-hidden /> Archive
                      </button>
                    ) : (
                      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => action('restore', `/admin/products/${product.id}/status`, { status: 'DRAFT' }, 'Product restored as a draft')}>
                        Restore
                      </button>
                    )}
                  </div>
                ) : null}
                {can('featured.manage') && live ? (
                  <button
                    type="button"
                    className="btn-secondary btn-sm w-full"
                    disabled={!!busy}
                    onClick={() => action('feature', `/admin/products/${product.id}/${product.isFeatured ? 'unfeature' : 'feature'}`, undefined, product.isFeatured ? 'Removed from featured' : 'Added to featured on the home page')}
                  >
                    <Star className={`size-4 ${product.isFeatured ? 'fill-sand-400 text-sand-500' : ''}`} aria-hidden /> {product.isFeatured ? 'Remove from featured' : 'Feature on home page'}
                  </button>
                ) : null}
                {status === 'DRAFT' && images.length === 0 ? <p className="hint">Add a photo before publishing.</p> : null}
              </div>
            </Card>
          ) : null}

          <fieldset disabled={!canEdit} className="contents">
<Card title="Organisation">
            <div className="space-y-4">
              <SelectField label={<>Category <span className="text-danger-600">*</span></>} value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">Choose…</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{categoryOptionLabel(c)}</option>)}
              </SelectField>
              <Field label="Brand" htmlFor="brand">
                {newBrand !== null ? (
                  <div className="flex gap-2">
                    <input id="brand" className="input" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} placeholder="New brand name" maxLength={80} autoFocus />
                    <button type="button" className="btn-primary btn-sm" disabled={!newBrand.trim()} onClick={() => createBrand(newBrand.trim())}>Add</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setNewBrand(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select id="brand" className="input" value={f.brandId} onChange={(e) => set({ brandId: e.target.value })}>
                      <option value="">No brand</option>
                      {brandMissing && product?.brand ? <option value={product.brand.id}>{product.brand.name}</option> : null}
                      {brandList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {can('products.moderate') ? <button type="button" className="btn-secondary btn-sm" onClick={() => setNewBrand('')}>New</button> : null}
                  </div>
                )}
              </Field>
              <TagsInput value={f.tags} onChange={(tags) => set({ tags })} />
            </div>
          </Card>
</fieldset>

          <fieldset disabled={!canEdit} className="contents">
<Card title="Returns, warranty and sizes">
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Return window (days)" inputMode="numeric" value={f.returnPolicyDays} onChange={(e) => set({ returnPolicyDays: e.target.value.replace(/\D/g, '') })} placeholder="Store default" hint="0 = not returnable" />
              <TextField label="Warranty (months)" inputMode="numeric" value={f.warrantyMonths} onChange={(e) => set({ warrantyMonths: e.target.value.replace(/\D/g, '') })} placeholder="None" />
            </div>
            <div className="mt-4 border-t border-ink-100 pt-4">
              <SelectField
                label="Size guide"
                hint="Opens from the Size option on the product page. Empty = the category's guide (if it has one) when the product comes in sizes."
                value={f.sizeChartId}
                onChange={(e) => set({ sizeChartId: e.target.value })}
                data-testid="product-size-chart"
              >
                <option value="">Category default</option>
                {f.sizeChartId && sizeCharts.data && !sizeCharts.data.some((c) => c.id === f.sizeChartId) ? <option value={f.sizeChartId}>The store's own guide</option> : null}
                {(sizeCharts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </div>
            <div className="mt-4 border-t border-ink-100 pt-4" data-testid="tracks-expiry">
              <Switch checked={f.tracksExpiry} onChange={(tracksExpiry) => set({ tracksExpiry })} label="Has an expiry date" description="Food, cosmetics, medicine: the expiry date is required when stock arrives, the oldest dates ship first, and expired units are taken off sale every night." />
            </div>
          </Card>
</fieldset>
        </div>
      </div>

      {canEdit ? (
        <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {product ? (
            <>
              <span className="me-auto text-sm text-ink-500">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
              {dirty ? <button type="button" className="btn-ghost" onClick={() => setF(saved)}>Discard</button> : null}
              <button type="submit" className="btn-primary" disabled={!dirty || !!busy}>{busy === 'save' ? <Spinner /> : null} Save</button>
            </>
          ) : (
            <>
              <Link href="/products" className="btn-ghost me-auto">Cancel</Link>
              <button type="submit" className="btn-secondary" disabled={!!busy}>{busy === 'save' ? <Spinner /> : null} Save as draft</button>
              <button type="button" className="btn-primary" disabled={!!busy} onClick={(e) => submit(e, true)}>{busy === 'publish' ? <Spinner /> : null} Save and publish</button>
            </>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === 'archive'}
        onClose={() => setConfirm(null)}
        onConfirm={() => product && action('archive', `/admin/products/${product.id}/status`, { status: 'ARCHIVED' }, 'Product archived')}
        title="Archive this product?"
        description="It disappears from the store and search. Past orders keep it. You can restore it later."
        confirmLabel="Archive"
        danger
        busy={busy === 'archive'}
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        onClose={() => setConfirm(null)}
        onConfirm={(reason) => product && action('reject', `/admin/products/${product.id}/reject`, { reason }, 'Product rejected')}
        title="Reject this product?"
        reason={{ label: 'Reason (sent to the seller)', required: true }}
        confirmLabel="Reject"
        danger
        busy={busy === 'reject'}
      />
    </form>
  );
}
