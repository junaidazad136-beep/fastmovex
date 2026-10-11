'use client';

import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Dialog, MoneyField, Spinner, Switch, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { decimalToMinor, formatMoney, minorToInput } from '@/lib/format';
import { useToast } from '@/lib/state/toast';
import { StockDialog, type StockTarget } from './StockDialog';
import { variantLabel } from './VariantsBuilder';

export interface SavedVariant {
  id: string;
  sku: string;
  barcode: string | null;
  optionValues: Record<string, string> | null;
  priceMinor: string;
  compareAtMinor: string | null;
  costPriceMinor: string | null;
  currencyCode: string;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  isActive: boolean;
  inventory: { onHand: number; reserved: number; lowStockThreshold: number } | null;
}

interface Form {
  options: Record<string, string>;
  sku: string;
  barcode: string;
  price: string;
  compareAt: string;
  cost: string;
  stock: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  isActive: boolean;
}

const digits = (s: string) => s.replace(/\D/g, '');
const numOrEmpty = (n: number | null | undefined) => (n ? String(n) : '');

function formOf(v: SavedVariant | null, optionNames: string[]): Form {
  return {
    options: Object.fromEntries(optionNames.map((n) => [n, v?.optionValues?.[n] ?? ''])),
    sku: v?.sku ?? '',
    barcode: v?.barcode ?? '',
    price: minorToInput(v?.priceMinor),
    compareAt: minorToInput(v?.compareAtMinor),
    cost: minorToInput(v?.costPriceMinor),
    stock: '',
    weight: numOrEmpty(v?.weightGrams),
    length: numOrEmpty(v?.lengthMm),
    width: numOrEmpty(v?.widthMm),
    height: numOrEmpty(v?.heightMm),
    isActive: v?.isActive ?? true,
  };
}

/** Variants of a saved product: edit price/SKU/shipping, switch on/off, change stock, add more. */
export function VariantsManager({ productId, productTitle, variants, onChanged, canEdit, canStock }: { productId: string; productTitle: string; variants: SavedVariant[]; onChanged: () => void; canEdit: boolean; canStock: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<SavedVariant | 'new' | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<StockTarget | null>(null);
  const optionNames = [...new Set(variants.flatMap((v) => Object.keys(v.optionValues ?? {})))];
  const single = variants.length === 1 && optionNames.length === 0;

  function open(v: SavedVariant | 'new') {
    setEditing(v);
    setForm(formOf(v === 'new' ? null : v, optionNames));
  }

  async function save() {
    if (!form || !editing) return;
    const price = decimalToMinor(form.price);
    if (!price || price === '0') return toast.error('Enter a valid price, e.g. 149.50');
    const compareAt = form.compareAt.trim() ? decimalToMinor(form.compareAt) : null;
    if (form.compareAt.trim() && !compareAt) return toast.error('Compare-at price is not a valid amount');
    if (compareAt && BigInt(compareAt) <= BigInt(price)) return toast.error('Compare-at price must be higher than the price');
    const cost = form.cost.trim() ? decimalToMinor(form.cost) : null;
    if (form.cost.trim() && !cost) return toast.error('Cost is not a valid amount');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.sku.trim())) return toast.error('SKU: letters, numbers, . _ - only');
    const optionValues = Object.fromEntries(Object.entries(form.options).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    if (optionNames.length && Object.keys(optionValues).length !== optionNames.length) return toast.error(`Fill in ${optionNames.join(' and ')}`);
    const int = (s: string) => (s ? Number.parseInt(s, 10) : undefined);

    setBusy(true);
    try {
      if (editing === 'new') {
        await api(`/admin/products/${productId}/variants`, {
          method: 'POST',
          body: {
            sku: form.sku.trim(), barcode: form.barcode.trim() || undefined, optionValues: optionNames.length ? optionValues : undefined,
            priceMinor: price, compareAtMinor: compareAt ?? undefined, costPriceMinor: cost ?? undefined, initialStock: int(form.stock) ?? 0,
            weightGrams: int(form.weight), lengthMm: int(form.length), widthMm: int(form.width), heightMm: int(form.height),
          },
        });
        toast.success('Variant added');
      } else {
        await api(`/admin/variants/${editing.id}`, {
          method: 'PATCH',
          body: {
            sku: form.sku.trim(), barcode: form.barcode.trim() || null, optionValues: optionNames.length ? optionValues : undefined,
            priceMinor: price, compareAtMinor: compareAt, costPriceMinor: cost, isActive: form.isActive,
            weightGrams: int(form.weight), lengthMm: int(form.length), widthMm: int(form.width), heightMm: int(form.height),
          },
        });
        toast.success('Variant saved');
      }
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(v: SavedVariant) {
    try {
      await api(`/admin/variants/${v.id}`, { method: 'PATCH', body: { isActive: !v.isActive } });
      toast.success(v.isActive ? 'Variant hidden from the store' : 'Variant is on sale again');
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-ink-100">
        <table className="w-full min-w-[720px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="th">{single ? 'SKU' : 'Variant'}</th>
              <th className="th text-end">Price</th>
              <th className="th text-end">Cost</th>
              <th className="th text-end">Available</th>
              <th className="th">On sale</th>
              <th className="th w-10"><span className="sr-only">Edit</span></th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const inv = v.inventory ?? { onHand: 0, reserved: 0, lowStockThreshold: 5 };
              const available = inv.onHand - inv.reserved;
              return (
                <tr key={v.id} className={v.isActive ? undefined : 'opacity-60'}>
                  <td className="td">
                    <p className="font-medium">{single ? v.sku : variantLabel(v.optionValues)}</p>
                    {!single ? <p className="text-xs text-ink-500">{v.sku}{v.barcode ? ` · ${v.barcode}` : ''}</p> : v.barcode ? <p className="text-xs text-ink-500">{v.barcode}</p> : null}
                  </td>
                  <td className="td text-end tabular">
                    {formatMoney(v.priceMinor, v.currencyCode)}
                    {v.compareAtMinor ? <p className="text-xs text-ink-400 line-through">{formatMoney(v.compareAtMinor, v.currencyCode)}</p> : null}
                  </td>
                  <td className="td text-end text-ink-600 tabular">{v.costPriceMinor ? formatMoney(v.costPriceMinor, v.currencyCode) : '—'}</td>
                  <td className="td text-end">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 font-medium tabular hover:bg-ink-100"
                      onClick={() => setStock({ variantId: v.id, label: `${productTitle}${single ? '' : ` – ${variantLabel(v.optionValues)}`}`, sku: v.sku, ...inv })}
                      title={canStock ? 'Change stock' : 'Stock history'}
                    >
                      {available <= 0 ? <Badge tone="red">Out of stock</Badge> : available <= inv.lowStockThreshold ? <Badge tone="amber">{available} left</Badge> : available}
                    </button>
                  </td>
                  <td className="td">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={v.isActive}
                      aria-label={`${variantLabel(v.optionValues)} on sale`}
                      disabled={!canEdit}
                      onClick={() => toggle(v)}
                      className={`relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${v.isActive ? 'bg-brand-600' : 'bg-ink-200'}`}
                    >
                      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${v.isActive ? 'start-[18px]' : 'start-0.5'}`} />
                    </button>
                  </td>
                  <td className="td">
                    {canEdit ? (
                      <button type="button" className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900" onClick={() => open(v)} aria-label={`Edit ${variantLabel(v.optionValues)}`}>
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && variants.length < 100 ? (
        <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => open('new')}>
          <Plus className="size-4" aria-hidden /> Add variant
        </button>
      ) : null}

      <Dialog
        open={!!editing && !!form}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add variant' : `Edit ${editing ? variantLabel(editing.optionValues) : ''}`}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : null} Save</button>
          </>
        }
      >
        {form ? (
          <div className="space-y-4">
            {optionNames.length ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {optionNames.map((n) => (
                  <TextField key={n} label={n} required value={form.options[n] ?? ''} onChange={(e) => set({ options: { ...form.options, [n]: e.target.value } })} maxLength={60} />
                ))}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <MoneyField label="Price" required value={form.price} onChange={(e) => set({ price: e.target.value })} />
              <MoneyField label="Compare-at price" value={form.compareAt} onChange={(e) => set({ compareAt: e.target.value })} hint="Empty = no old price" />
              <MoneyField label="Cost per item" value={form.cost} onChange={(e) => set({ cost: e.target.value })} hint="Private" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="SKU" required value={form.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} maxLength={64} />
              <TextField label="Barcode" value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} maxLength={48} />
              {editing === 'new' ? <TextField label="Opening stock" inputMode="numeric" value={form.stock} onChange={(e) => set({ stock: digits(e.target.value) })} /> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <TextField label="Weight (g)" inputMode="numeric" value={form.weight} onChange={(e) => set({ weight: digits(e.target.value) })} />
              <TextField label="Length (mm)" inputMode="numeric" value={form.length} onChange={(e) => set({ length: digits(e.target.value) })} />
              <TextField label="Width (mm)" inputMode="numeric" value={form.width} onChange={(e) => set({ width: digits(e.target.value) })} />
              <TextField label="Height (mm)" inputMode="numeric" value={form.height} onChange={(e) => set({ height: digits(e.target.value) })} />
            </div>
            {editing !== 'new' ? <Switch checked={form.isActive} onChange={(isActive) => set({ isActive })} label="On sale" description="Turn off to hide this variant without deleting it" /> : null}
          </div>
        ) : null}
      </Dialog>

      <StockDialog target={stock} onClose={() => setStock(null)} onSaved={() => onChanged()} canAdjust={canStock} />
    </>
  );
}
