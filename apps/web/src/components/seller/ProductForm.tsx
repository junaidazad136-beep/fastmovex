'use client';

import { ImagePlus, Minus, Plus, Send, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import type { CategoryNode } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { decimalToMinor, minorToDecimalString } from '@/lib/money';
import { useShop } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';
import { Field } from './BecomeSeller';
import { SizeChartPicker } from './SizeChartPicker';
import { PRODUCT_TONE } from './Products';
import type { SellerProductDetail } from './types';

/** "PowerCore 20000" → "POWERCORE-20000-7K2Q": a readable code the seller can keep or change. */
export function suggestSku(title: string, rand = Math.random): string {
  const words = title.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const tail = Array.from({ length: 4 }, () => '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(rand() * 32)]).join('');
  return [...words.map((w) => w.slice(0, 10)), tail].join('-').slice(0, 64);
}

function useCategories() {
  const t = useT();
  const [list, setList] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    api<CategoryNode[]>('/categories', { auth: 'none' }).then((tree) => {
      const out: { id: string; label: string }[] = [];
      const walk = (nodes: CategoryNode[], prefix: string) => nodes.forEach((n) => {
        const name = pick(t.locale, n.name, n.nameAr);
        out.push({ id: n.id, label: prefix ? `${prefix} › ${name}` : name });
        walk(n.children ?? [], prefix ? `${prefix} › ${name}` : name);
      });
      walk(tree, '');
      setList(out);
    }).catch(() => setList([]));
  }, [t.locale]);
  return list;
}

interface Basics { title: string; titleAr: string; shortDescription: string; shortDescriptionAr: string; brandId: string; categoryId: string; description: string; descriptionAr: string; warrantyMonths: string; returnPolicyDays: string; sizeChartId: string }

/** Brands a seller can pick (FastMoveX adds new ones on request). */
function useBrands() {
  const [list, setList] = useState<{ id: string; label: string }[]>([]);
  const t = useT();
  useEffect(() => {
    api<{ id: string; name: string; nameAr: string | null }[]>('/brands')
      .then((rows) => setList(rows.map((b) => ({ id: b.id, label: pick(t.locale, b.name, b.nameAr) }))))
      .catch(() => setList([]));
  }, [t.locale]);
  return list;
}
const intOrUndefined = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Math.round(Number(v))));

function BasicsFields({ f, setF }: { f: Basics; setF: (f: Basics) => void }) {
  const t = useT();
  const cats = useCategories();
  const brands = useBrands();
  const set = (k: keyof Basics) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <Field id="pf-title" label={t('seller.form.titleEn')}><input id="pf-title" className="input" required minLength={3} maxLength={200} value={f.title} onChange={set('title')} /></Field>
      <Field id="pf-title-ar" label={t('seller.form.titleAr')}><input id="pf-title-ar" className="input" dir="rtl" maxLength={200} value={f.titleAr} onChange={set('titleAr')} /></Field>
      <Field id="pf-short" label={t('seller.form.shortLine')} hint={t('seller.form.shortLineHint')}><input id="pf-short" className="input" maxLength={300} value={f.shortDescription} onChange={set('shortDescription')} /></Field>
      <Field id="pf-short-ar" label={t('seller.form.shortLineAr')}><input id="pf-short-ar" className="input" dir="rtl" maxLength={300} value={f.shortDescriptionAr} onChange={set('shortDescriptionAr')} /></Field>
      <Field id="pf-brand" label={t('seller.form.brand')} hint={t('seller.form.brandHint')}>
        <select id="pf-brand" className="input" value={f.brandId} onChange={set('brandId')}>
          <option value="">{t('seller.form.noBrand')}</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </Field>
      <Field id="pf-cat" label={t('seller.form.category')}>
        <select id="pf-cat" className="input" required value={f.categoryId} onChange={set('categoryId')}>
          <option value="">{t('seller.form.choose')}</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field id="pf-desc" label={t('seller.form.description')}><textarea id="pf-desc" className="input min-h-28" maxLength={10000} value={f.description} onChange={set('description')} /></Field>
      <Field id="pf-desc-ar" label={t('seller.form.descriptionAr')}><textarea id="pf-desc-ar" className="input min-h-28" dir="rtl" maxLength={10000} value={f.descriptionAr} onChange={set('descriptionAr')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="pf-warranty" label={t('seller.form.warranty')}><input id="pf-warranty" className="input" inputMode="numeric" value={f.warrantyMonths} onChange={set('warrantyMonths')} /></Field>
        <Field id="pf-return" label={t('seller.form.returnDays')}><input id="pf-return" className="input" inputMode="numeric" value={f.returnPolicyDays} onChange={set('returnPolicyDays')} /></Field>
      </div>
      <SizeChartPicker value={f.sizeChartId} onChange={(sizeChartId) => setF({ ...f, sizeChartId })} />
    </div>
  );
}

const basicsBody = (f: Basics) => ({
  title: f.title.trim(), categoryId: f.categoryId,
  ...(f.titleAr.trim() && { titleAr: f.titleAr.trim() }),
  shortDescription: f.shortDescription.trim(), shortDescriptionAr: f.shortDescriptionAr.trim(),
  brandId: f.brandId || null,
  sizeChartId: f.sizeChartId || null,
  description: f.description, descriptionAr: f.descriptionAr,
  ...(intOrUndefined(f.warrantyMonths) !== undefined && { warrantyMonths: Math.min(120, intOrUndefined(f.warrantyMonths)!) }),
  ...(intOrUndefined(f.returnPolicyDays) !== undefined && { returnPolicyDays: Math.min(90, intOrUndefined(f.returnPolicyDays)!) }),
});

/** New product: the basics plus one price and stock. Photos come next (on the product's own page). */
export function NewProductForm() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const { market } = useShop();
  const mu = market.currency.minorUnits;
  const [f, setF] = useState<Basics>({ title: '', titleAr: '', shortDescription: '', shortDescriptionAr: '', brandId: '', categoryId: '', description: '', descriptionAr: '', warrantyMonths: '', returnPolicyDays: '', sizeChartId: '' });
  const [v, setV] = useState({ price: '', oldPrice: '', stock: '1', sku: '', barcode: '' });
  const [skuTouched, setSkuTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!skuTouched && f.title.trim().length >= 3) setV((x) => ({ ...x, sku: suggestSku(f.title) })); }, [f.title, skuTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const price = decimalToMinor(v.price, mu);
    const old = v.oldPrice.trim() ? decimalToMinor(v.oldPrice, mu) : null;
    if (!price || BigInt(price) <= 0n || (v.oldPrice.trim() && !old)) { setError(t('seller.form.invalidPrice')); return; }
    setBusy(true); setError('');
    try {
      const p = await api<SellerProductDetail>('/seller/products', {
        method: 'POST',
        body: {
          ...basicsBody(f),
          variants: [{
            sku: v.sku.trim() || suggestSku(f.title), priceMinor: price, initialStock: Math.max(0, Math.round(Number(v.stock) || 0)),
            ...(old && BigInt(old) > BigInt(price) && { compareAtMinor: old }), ...(v.barcode.trim() && { barcode: v.barcode.trim() }),
          }],
        },
      });
      toast({ tone: 'success', message: t('seller.form.created') });
      router.replace(paths.sellerProduct(t.locale, p.id));
    } catch (err) { setError(errorMessage(err, t)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4" data-testid="new-product">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('seller.form.newTitle')}</h1>
      <section className="card p-4 sm:p-5"><BasicsFields f={f} setF={setF} /></section>
      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold">{t('seller.form.priceStock')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="pf-price" label={t('seller.form.price', { currency: market.currency.code })}><input id="pf-price" className="input" inputMode="decimal" required dir="ltr" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} placeholder="49.00" /></Field>
          <Field id="pf-old" label={t('seller.form.oldPrice')} hint={t('seller.form.oldPriceHint')}><input id="pf-old" className="input" inputMode="decimal" dir="ltr" value={v.oldPrice} onChange={(e) => setV({ ...v, oldPrice: e.target.value })} /></Field>
          <Field id="pf-stock" label={t('seller.form.stock')}><input id="pf-stock" className="input" inputMode="numeric" dir="ltr" value={v.stock} onChange={(e) => setV({ ...v, stock: e.target.value.replace(/[^\d]/g, '') })} /></Field>
          <Field id="pf-barcode" label={t('seller.form.barcode')}><input id="pf-barcode" className="input" inputMode="numeric" dir="ltr" value={v.barcode} onChange={(e) => setV({ ...v, barcode: e.target.value })} /></Field>
        </div>
        <Field id="pf-sku" label={t('seller.form.sku')} hint={t('seller.form.skuHint')}><input id="pf-sku" className="input font-mono" dir="ltr" maxLength={64} value={v.sku} onChange={(e) => { setSkuTouched(true); setV({ ...v, sku: e.target.value.toUpperCase().replace(/[^A-Z0-9._-]/g, '') }); }} /></Field>
      </section>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn-primary btn-lg w-full" disabled={busy || f.title.trim().length < 3 || !f.categoryId || !v.price.trim()} data-testid="create-product">{busy && <Spinner />}{t('seller.form.saveDraft')}</button>
    </form>
  );
}

/** One product: status, photos, the basics, price and stock — and "Send for review". */
export function EditProduct({ id }: { id: string }) {
  const t = useT();
  const toast = useToast();
  const { market } = useShop();
  const mu = market.currency.minorUnits;
  const [p, setP] = useState<SellerProductDetail | null>(null);
  const [f, setF] = useState<Basics | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'send' | 'photo'>('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<SellerProductDetail>(`/seller/products/${id}`);
      setP(d);
      setF((x) => x ?? {
        title: d.title, titleAr: d.titleAr ?? '', shortDescription: d.shortDescription ?? '', shortDescriptionAr: d.shortDescriptionAr ?? '', brandId: d.brandId ?? '', categoryId: d.categoryId, description: d.description ?? '', descriptionAr: d.descriptionAr ?? '',
        warrantyMonths: d.warrantyMonths?.toString() ?? '', returnPolicyDays: d.returnPolicyDays?.toString() ?? '', sizeChartId: d.sizeChartId ?? '',
      });
    } catch (e) { setError(errorMessage(e, t)); }
  }, [id, t]);
  useEffect(() => { void load(); }, [load]);

  async function save(submitForReview: boolean) {
    if (!f) return;
    setBusy(submitForReview ? 'send' : 'save');
    try {
      await api(`/seller/products/${id}`, { method: 'PATCH', body: { ...basicsBody(f), ...(submitForReview && { submitForReview: true }) } });
      toast({ tone: 'success', message: submitForReview ? t('seller.form.sent') : t('seller.form.saved') });
      await load();
    } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); } finally { setBusy(''); }
  }
  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy('photo');
    try {
      for (const file of files.slice(0, 8)) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/seller/products/${id}/images`, { method: 'POST', body: fd });
      }
      await load();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(''); }
  }
  /** which colour (first option value) a photo shows; the shop puts it on that colour's card */
  async function linkPhoto(imageId: string, variantId: string | null, label: string) {
    try {
      await api(`/seller/images/${imageId}`, { method: 'PATCH', body: { variantId } });
      toast({ tone: 'success', message: label });
      await load();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); }
  }
  async function removePhoto(imageId: string) {
    try { await api(`/seller/images/${imageId}`, { method: 'DELETE' }); await load(); } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); }
  }

  if (error) return <p className="card p-6 text-danger-600" role="alert">{error}</p>;
  if (!p || !f) return <div className="space-y-3"><div className="skeleton h-8 w-64" /><div className="skeleton h-40" /><div className="skeleton h-64" /></div>;
  const canSend = p.status === 'DRAFT' || p.status === 'REJECTED';
  const optName = Object.keys(p.variants.find((v) => v.optionValues && Object.keys(v.optionValues).length)?.optionValues ?? {})[0];
  const choices = optName ? [...new Map(p.variants.filter((v) => v.optionValues?.[optName]).map((v) => [v.optionValues![optName], v.id])).entries()] : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="edit-product">
      <Link href={paths.sellerProducts(t.locale)} className="link text-sm">{t('seller.nav.products')}</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-bold tracking-tight">{p.title}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${PRODUCT_TONE[p.status]}`} data-testid="product-status">{t(`seller.products.status.${p.status}`)}</span>
      </div>
      {p.moderationNote && (p.status === 'REJECTED' || p.status === 'DRAFT') && <p className="rounded-2xl bg-danger-50 p-3 text-sm text-danger-600">{t('seller.form.reviewNote', { note: p.moderationNote })}</p>}
      {p.status === 'ACTIVE' && <p className="rounded-2xl bg-success-50 p-3 text-sm text-success-700">{t('seller.form.liveHint')} <Link href={paths.product(t.locale, p.slug)} className="link">↗</Link></p>}

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold">{t('seller.form.photos')}</h2>
        <p className="hint">{t('seller.form.photoHint')}</p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {p.images.map((img) => (
            <li key={img.id} className="relative aspect-square overflow-hidden rounded-xl bg-ink-50 ring-1 ring-ink-100">
              {img.url && <Image src={img.url} alt="" fill sizes="160px" className="object-cover" unoptimized />}
              <button type="button" onClick={() => void removePhoto(img.id)} className="absolute end-1 top-1 flex size-8 items-center justify-center rounded-full bg-white/90 text-danger-600 shadow" aria-label={t('seller.form.removePhoto')}><Trash2 className="size-4" aria-hidden /></button>
              {choices.length > 1 && (
                <select
                  className="absolute inset-x-1 bottom-1 rounded-lg border border-ink-200 bg-white/95 px-1.5 py-1 text-xs"
                  value={p.variants.find((v) => v.id === img.variantId)?.optionValues?.[optName!] ?? ''}
                  onChange={(e) => { const c = choices.find(([value]) => value === e.target.value); void linkPhoto(img.id, c?.[1] ?? null, c ? t('seller.form.photoLinked', { value: c[0] }) : t('seller.form.photoAll')); }}
                  aria-label={optName}
                  data-testid="photo-option"
                >
                  <option value="">{t('seller.form.photoAll')}</option>
                  {choices.map(([value]) => <option key={value} value={value}>{value}</option>)}
                </select>
              )}
            </li>
          ))}
          <li>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'photo'} className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-200 text-sm font-medium text-ink-600 hover:border-brand-400 hover:text-brand-700" data-testid="add-photo">
              {busy === 'photo' ? <Spinner /> : <ImagePlus className="size-6" aria-hidden />}{t('seller.form.addPhoto')}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={addPhoto} tabIndex={-1} aria-hidden data-testid="add-photo-input" />
          </li>
        </ul>
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold">{t('seller.form.priceStock')}</h2>
        {p.variants.filter((v) => v.isActive).map((v) => <VariantRow key={v.id} v={v} mu={mu} currency={market.currency.code} onChanged={load} />)}
      </section>

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="font-semibold">{t('seller.form.basics')}</h2>
        <BasicsFields f={f} setF={setF} />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-secondary btn-lg flex-1" disabled={!!busy} onClick={() => void save(false)} data-testid="save-product">{busy === 'save' && <Spinner />}{t('seller.form.saveDraft')}</button>
        {canSend && (
          <button type="button" className="btn-primary btn-lg flex-1" disabled={!!busy || p.images.length === 0} onClick={() => void save(true)} data-testid="send-review" title={p.images.length === 0 ? t('seller.form.needPhoto') : undefined}>
            {busy === 'send' ? <Spinner /> : <Send className="size-5 rtl:rotate-180" aria-hidden />}{t('seller.form.sendReview')}
          </button>
        )}
      </div>
      {canSend && p.images.length === 0 && <p className="hint text-center">{t('seller.form.needPhoto')}</p>}
    </div>
  );
}

function VariantRow({ v, mu, currency, onChanged }: { v: SellerProductDetail['variants'][number]; mu: number; currency: string; onChanged: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [price, setPrice] = useState(minorToDecimalString(v.priceMinor, mu));
  const [old, setOld] = useState(v.compareAtMinor ? minorToDecimalString(v.compareAtMinor, mu) : '');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState('');
  const available = useMemo(() => (v.inventory ? v.inventory.onHand - v.inventory.reserved : 0), [v.inventory]);

  async function savePrice(e: React.FormEvent) {
    e.preventDefault();
    const p = decimalToMinor(price, mu);
    const o = old.trim() ? decimalToMinor(old, mu) : null;
    if (!p || BigInt(p) <= 0n || (old.trim() && !o)) { toast({ tone: 'error', message: t('seller.form.invalidPrice') }); return; }
    setBusy('price');
    try {
      await api(`/seller/variants/${v.id}`, { method: 'PATCH', body: { priceMinor: p, compareAtMinor: o && BigInt(o) > BigInt(p) ? o : null } });
      toast({ tone: 'success', message: t('seller.form.saved') });
      await onChanged();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(''); }
  }
  async function stock(sign: 1 | -1) {
    const n = Math.round(Number(qty));
    if (!n || n < 1) return;
    setBusy(sign > 0 ? 'add' : 'remove');
    try {
      await api(`/seller/variants/${v.id}/stock`, { method: 'POST', body: { delta: sign * n, reason: sign > 0 ? 'RESTOCK' : 'ADJUSTMENT' } });
      toast({ tone: 'success', message: t('seller.form.saved') });
      await onChanged();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(''); }
  }

  const opts = v.optionValues ? Object.values(v.optionValues).filter(Boolean).join(' / ') : '';
  return (
    <div className="space-y-3 rounded-xl border border-ink-100 p-3">
      <p className="text-sm text-ink-600"><span className="font-mono" dir="ltr">{v.sku}</span>{opts ? ` · ${opts}` : ''}</p>
      <form onSubmit={savePrice} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field id={`vp-${v.id}`} label={t('seller.form.price', { currency })}><input id={`vp-${v.id}`} className="input" inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field id={`vo-${v.id}`} label={t('seller.form.oldPrice')}><input id={`vo-${v.id}`} className="input" inputMode="decimal" dir="ltr" value={old} onChange={(e) => setOld(e.target.value)} /></Field>
        <button type="submit" className="btn-secondary col-span-2 sm:col-span-1" disabled={busy === 'price'}>{busy === 'price' && <Spinner />}{t('seller.form.updatePrice')}</button>
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <p className={`tabular w-full text-sm font-semibold ${available <= 0 ? 'text-danger-600' : 'text-ink-800'}`} data-testid="stock-now">{t('seller.form.stockNow', { count: available })}</p>
        <div className="w-24">
          <Field id={`vq-${v.id}`} label={t('seller.form.quantity')}><input id={`vq-${v.id}`} className="input" inputMode="numeric" dir="ltr" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} /></Field>
        </div>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void stock(1)} data-testid="stock-add">{busy === 'add' ? <Spinner /> : <Plus className="size-4" aria-hidden />}{t('seller.form.addStock')}</button>
        <button type="button" className="btn-ghost" disabled={!!busy || available <= 0} onClick={() => void stock(-1)}>{busy === 'remove' ? <Spinner /> : <Minus className="size-4" aria-hidden />}{t('seller.form.removeStock')}</button>
      </div>
    </div>
  );
}
