'use client';

import { useState } from 'react';
import { SearchInput, Spinner } from '@/components/ui';
import type { NumberedPage } from '@/lib/api/types';
import { formatMoney } from '@/lib/format';
import { qs, useApi } from '@/lib/use-api';
import { variantLabel } from './VariantsBuilder';

export interface PickedVariant { variantId: string; sku: string; title: string; optionValues: Record<string, string> | null; priceMinor: string; currencyCode: string; available: number; status: string }

/** Search any variant by product title, SKU or barcode and pick one. */
export function VariantPicker({ onPick, exclude = [] }: { onPick: (v: PickedVariant) => void; exclude?: string[] }) {
  const [q, setQ] = useState('');
  const res = useApi<NumberedPage<PickedVariant>>(q.trim().length >= 2 ? `/admin/inventory${qs({ q: q.trim(), limit: 10 })}` : null);
  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder="Search product, SKU or barcode" />
      {q.trim().length >= 2 ? (
        <ul className="mt-2 max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100">
          {res.loading && !res.data ? <li className="flex justify-center p-4"><Spinner /></li> : null}
          {res.data?.items.map((v) => {
            const taken = exclude.includes(v.variantId);
            return (
              <li key={v.variantId}>
                <button type="button" disabled={taken} onClick={() => onPick(v)} className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-ink-50 disabled:opacity-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.title}</span>
                    <span className="block text-xs text-ink-500">{v.sku}{Object.keys(v.optionValues ?? {}).length ? ` · ${variantLabel(v.optionValues)}` : ''} · {v.available} in stock{v.status !== 'ACTIVE' ? ` · ${v.status.toLowerCase()}` : ''}</span>
                  </span>
                  <span className="tabular">{formatMoney(v.priceMinor, v.currencyCode)}</span>
                  {taken ? <span className="text-xs text-ink-500">Added</span> : null}
                </button>
              </li>
            );
          })}
          {res.data && res.data.items.length === 0 ? <li className="p-4 text-center text-sm text-ink-500">Nothing found</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
