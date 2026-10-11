'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { Field, MoneyField, Switch, TextField } from '@/components/ui';
import { decimalToMinor } from '@/lib/format';

/** One sellable version of a new product, as typed (money as decimal text). */
export interface DraftVariant {
  key: string;
  optionValues: Record<string, string>;
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
}

export interface DraftOption { name: string; values: string }

export function emptyVariant(optionValues: Record<string, string> = {}, key = 'single'): DraftVariant {
  return { key, optionValues, sku: '', barcode: '', price: '', compareAt: '', cost: '', stock: '', weight: '', length: '', width: '', height: '' };
}

function parseValues(s: string): string[] {
  return [...new Set(s.split(',').map((v) => v.trim()).filter(Boolean))];
}

/** Every combination of the option values: Colour × Size → Black/S, Black/M, … */
export function combinations(options: DraftOption[]): Record<string, string>[] {
  const used = options.filter((o) => o.name.trim() && parseValues(o.values).length);
  let out: Record<string, string>[] = [{}];
  for (const o of used) {
    const next: Record<string, string>[] = [];
    for (const base of out) for (const v of parseValues(o.values)) next.push({ ...base, [o.name.trim()]: v });
    out = next;
  }
  return used.length ? out : [];
}

export function variantKey(ov: Record<string, string>): string {
  return Object.entries(ov).map(([k, v]) => `${k}=${v}`).join('|') || 'single';
}

export function variantLabel(ov: Record<string, string> | null | undefined): string {
  const vals = Object.values(ov ?? {});
  return vals.length ? vals.join(' / ') : 'Default';
}

const int = (s: string) => (s.trim() === '' ? undefined : Number.parseInt(s, 10));

/** Checks the typed variants and turns them into the API's VariantInputDto list, or returns the first problem. */
export function toVariantInputs(variants: DraftVariant[]): { ok: true; value: Record<string, unknown>[] } | { ok: false; error: string } {
  if (variants.length === 0) return { ok: false, error: 'Add at least one option value, or turn options off.' };
  const skus = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const v of variants) {
    const name = variantLabel(v.optionValues);
    const sku = v.sku.trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(sku)) return { ok: false, error: `${name}: SKU is required (letters, numbers, . _ - only)` };
    if (skus.has(sku.toUpperCase())) return { ok: false, error: `SKU ${sku} is used twice` };
    skus.add(sku.toUpperCase());
    const price = decimalToMinor(v.price);
    if (!price || price === '0') return { ok: false, error: `${name}: enter a price, e.g. 149.50` };
    const compareAt = v.compareAt.trim() ? decimalToMinor(v.compareAt) : undefined;
    if (compareAt === null) return { ok: false, error: `${name}: "compare-at" price is not a valid amount` };
    if (compareAt && BigInt(compareAt) <= BigInt(price)) return { ok: false, error: `${name}: "compare-at" price must be higher than the price` };
    const cost = v.cost.trim() ? decimalToMinor(v.cost) : undefined;
    if (cost === null) return { ok: false, error: `${name}: cost is not a valid amount` };
    const barcode = v.barcode.trim() || undefined;
    if (barcode && !/^[A-Za-z0-9-]{4,48}$/.test(barcode)) return { ok: false, error: `${name}: barcode must be 4–48 letters, digits or dashes` };
    out.push({
      sku,
      optionValues: Object.keys(v.optionValues).length ? v.optionValues : undefined,
      priceMinor: price,
      compareAtMinor: compareAt || undefined,
      costPriceMinor: cost || undefined,
      barcode,
      initialStock: int(v.stock) ?? 0,
      weightGrams: int(v.weight) || undefined,
      lengthMm: int(v.length) || undefined,
      widthMm: int(v.width) || undefined,
      heightMm: int(v.height) || undefined,
    });
  }
  return { ok: true, value: out };
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Price, stock and shipping fields of a product without options. */
export function SingleVariantFields({ v, onChange }: { v: DraftVariant; onChange: (v: DraftVariant) => void }) {
  const set = (patch: Partial<DraftVariant>) => onChange({ ...v, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyField label="Price" required value={v.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" />
        <MoneyField label="Compare-at price" value={v.compareAt} onChange={(e) => set({ compareAt: e.target.value })} placeholder="0.00" hint="Shown crossed out" />
        <MoneyField label="Cost per item" value={v.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="0.00" hint="Private: for your margin" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="SKU" required value={v.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} placeholder="e.g. KET-17-SLV" maxLength={64} />
        <TextField label="Barcode" value={v.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="EAN / UPC" maxLength={48} />
        <TextField label="Stock" inputMode="numeric" value={v.stock} onChange={(e) => set({ stock: digits(e.target.value) })} placeholder="0" />
      </div>
      <ShippingFields v={v} onChange={set} />
    </div>
  );
}

function ShippingFields({ v, onChange }: { v: Pick<DraftVariant, 'weight' | 'length' | 'width' | 'height'>; onChange: (p: Partial<DraftVariant>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <TextField label="Weight (g)" inputMode="numeric" value={v.weight} onChange={(e) => onChange({ weight: digits(e.target.value) })} />
      <TextField label="Length (mm)" inputMode="numeric" value={v.length} onChange={(e) => onChange({ length: digits(e.target.value) })} />
      <TextField label="Width (mm)" inputMode="numeric" value={v.width} onChange={(e) => onChange({ width: digits(e.target.value) })} />
      <TextField label="Height (mm)" inputMode="numeric" value={v.height} onChange={(e) => onChange({ height: digits(e.target.value) })} />
    </div>
  );
}

/**
 * Options builder for a new product: up to 3 options (Colour, Size, Storage…), each with comma-separated values.
 * Every combination becomes a variant with its own SKU, price and stock. Values already typed are kept when the
 * options change.
 */
export function VariantsBuilder({
  hasOptions, setHasOptions, options, setOptions, variants, setVariants,
}: {
  hasOptions: boolean;
  setHasOptions: (v: boolean) => void;
  options: DraftOption[];
  setOptions: (o: DraftOption[]) => void;
  variants: DraftVariant[];
  setVariants: (v: DraftVariant[]) => void;
}) {
  const combos = combinations(options);
  const comboKey = combos.map(variantKey).join(',');

  // Rebuild the variant rows when the combinations change, keeping what was typed for rows that still exist.
  useEffect(() => {
    if (!hasOptions) return;
    const byKey = new Map(variants.map((v) => [v.key, v]));
    setVariants(combos.map((ov) => byKey.get(variantKey(ov)) ?? emptyVariant(ov, variantKey(ov))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboKey, hasOptions]);

  const setOpt = (i: number, patch: Partial<DraftOption>) => setOptions(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const setVar = (i: number, patch: Partial<DraftVariant>) => setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  /** Fill a column from the first row ("same price for all"). */
  const fillDown = (field: 'price' | 'compareAt' | 'cost' | 'stock' | 'weight') => {
    const first = variants[0]?.[field] ?? '';
    setVariants(variants.map((v) => ({ ...v, [field]: first })));
  };

  return (
    <div className="space-y-4">
      <Switch
        checked={hasOptions}
        onChange={(v) => {
          setHasOptions(v);
          if (!v) setVariants([variants[0] ? { ...variants[0], key: 'single', optionValues: {} } : emptyVariant()]);
          else if (!options.length) setOptions([{ name: 'Colour', values: '' }]);
        }}
        label="This product has options"
        description="Like different colours or sizes, each with its own SKU, price and stock"
      />

      {!hasOptions ? (
        <SingleVariantFields v={variants[0] ?? emptyVariant()} onChange={(v) => setVariants([v])} />
      ) : (
        <>
          <div className="space-y-3 rounded-xl border border-ink-100 bg-ink-25 p-3">
            {options.map((o, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                <Field label={i === 0 ? 'Option' : <span className="sr-only">Option {i + 1}</span>} htmlFor={`opt-name-${i}`}>
                  <input id={`opt-name-${i}`} className="input" value={o.name} onChange={(e) => setOpt(i, { name: e.target.value })} placeholder="e.g. Size" maxLength={30} />
                </Field>
                <Field label={i === 0 ? 'Values (comma separated)' : <span className="sr-only">Values {i + 1}</span>} htmlFor={`opt-values-${i}`}>
                  <input id={`opt-values-${i}`} className="input" value={o.values} onChange={(e) => setOpt(i, { values: e.target.value })} placeholder="e.g. Small, Medium, Large" />
                </Field>
                <div className={i === 0 ? 'sm:pt-6' : ''}>
                  <button type="button" className="btn-ghost px-2" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={`Remove option ${o.name || i + 1}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
            {options.length < 3 ? (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setOptions([...options, { name: '', values: '' }])}>
                <Plus className="size-4" aria-hidden /> Add another option
              </button>
            ) : null}
          </div>

          {variants.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-ink-100">
              <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="th">Variant</th>
                    <th className="th">SKU *</th>
                    <th className="th">
                      Price (QAR) *{variants.length > 1 ? <button type="button" className="ms-1 font-normal normal-case text-brand-600 hover:underline" onClick={() => fillDown('price')}>same for all</button> : null}
                    </th>
                    <th className="th">Compare-at</th>
                    <th className="th">Cost</th>
                    <th className="th">
                      Stock{variants.length > 1 ? <button type="button" className="ms-1 font-normal normal-case text-brand-600 hover:underline" onClick={() => fillDown('stock')}>same for all</button> : null}
                    </th>
                    <th className="th">Barcode</th>
                    <th className="th">Weight (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v, i) => (
                    <tr key={v.key}>
                      <td className="td font-medium whitespace-nowrap">{variantLabel(v.optionValues)}</td>
                      <td className="td"><input className="input min-w-[120px] py-1.5" value={v.sku} onChange={(e) => setVar(i, { sku: e.target.value.toUpperCase() })} aria-label={`SKU for ${variantLabel(v.optionValues)}`} maxLength={64} /></td>
                      <td className="td"><input className="input w-24 py-1.5 tabular" inputMode="decimal" value={v.price} onChange={(e) => setVar(i, { price: e.target.value })} aria-label={`Price for ${variantLabel(v.optionValues)}`} /></td>
                      <td className="td"><input className="input w-24 py-1.5 tabular" inputMode="decimal" value={v.compareAt} onChange={(e) => setVar(i, { compareAt: e.target.value })} aria-label={`Compare-at price for ${variantLabel(v.optionValues)}`} /></td>
                      <td className="td"><input className="input w-24 py-1.5 tabular" inputMode="decimal" value={v.cost} onChange={(e) => setVar(i, { cost: e.target.value })} aria-label={`Cost for ${variantLabel(v.optionValues)}`} /></td>
                      <td className="td"><input className="input w-20 py-1.5 tabular" inputMode="numeric" value={v.stock} onChange={(e) => setVar(i, { stock: digits(e.target.value) })} aria-label={`Stock for ${variantLabel(v.optionValues)}`} /></td>
                      <td className="td"><input className="input w-32 py-1.5" value={v.barcode} onChange={(e) => setVar(i, { barcode: e.target.value })} aria-label={`Barcode for ${variantLabel(v.optionValues)}`} maxLength={48} /></td>
                      <td className="td"><input className="input w-20 py-1.5 tabular" inputMode="numeric" value={v.weight} onChange={(e) => setVar(i, { weight: digits(e.target.value) })} aria-label={`Weight for ${variantLabel(v.optionValues)}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-ink-500">Type option values to create the variants.</p>
          )}
          {variants.length > 100 ? <p className="field-error">A product can have at most 100 variants.</p> : null}
        </>
      )}
    </div>
  );
}
