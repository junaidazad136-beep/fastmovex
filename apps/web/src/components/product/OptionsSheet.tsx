'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ProductDetail } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { Dialog } from '../ui/Dialog';
import { effectivePrice } from './Price';
import { defaultVariant, findVariant, isValueAvailable, optionNames, optionValues, selectValue } from './variants';

/**
 * For products with a colour / size: the "Add to cart" on a result opens this sheet from the bottom instead of
 * leaving the page. Pick the option, add, and the sheet closes; the shopper stays on the results.
 */
export function OptionsSheet({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const cart = useCart();
  const toast = useToast();
  const money = useMoney();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || product) return;
    api<ProductDetail>(`/products/${encodeURIComponent(slug)}`, { auth: 'none' })
      .then((p) => { setProduct(p); setSelected({ ...(defaultVariant(p.variants)?.optionValues ?? {}) }); })
      .catch((e) => { toast({ tone: 'error', message: errorMessage(e, t) }); onClose(); });
  }, [open, product, slug, t, toast, onClose]);

  const title = product ? pick(t.locale, product.title, product.titleAr) : '';
  const word = (w: string) => (t.locale === 'ar' ? product?.optionsAr?.[w] ?? w : w);
  const variant = product ? findVariant(product.variants, selected) : undefined;
  const price = variant ? effectivePrice(variant) : null;
  const image = product ? (product.images.find((i) => i.kind === 'IMAGE' && i.variantId === variant?.id && i.url) ?? product.images.find((i) => i.kind === 'IMAGE' && i.url))?.url : null;

  async function add() {
    if (!variant) return;
    setBusy(true);
    try {
      await cart.add(variant.id, 1);
      haptic('success');
      toast({ tone: 'success', message: t('card.added') });
      onClose();
    } catch (e) {
      haptic('error');
      toast({ tone: 'error', message: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} sheet title={t('search.pickOptions')} closeLabel={t('common.close')}>
      {!product ? (
        <div className="space-y-3" aria-busy="true">
          <div className="flex gap-3"><div className="size-20 animate-pulse rounded-xl bg-ink-100" /><div className="flex-1 space-y-2 pt-1"><div className="h-4 animate-pulse rounded bg-ink-100" /><div className="h-4 w-1/2 animate-pulse rounded bg-ink-100" /></div></div>
          <div className="h-10 animate-pulse rounded-xl bg-ink-100" />
        </div>
      ) : (
        <div data-testid="options-sheet">
          <div className="flex gap-3">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-ink-50">{image ? <Image src={image} alt="" fill sizes="80px" className="object-contain p-1.5" /> : null}</div>
            <div className="min-w-0">
              <p className="line-clamp-2 text-[14px] font-medium leading-[19px] text-ink-900">{title}</p>
              {price ? (
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className="tabular text-[18px] font-extrabold text-brand-700">{money(price.now, { compact: true })}</span>
                  {price.was ? <span className="tabular text-[12px] text-ink-400 line-through">{money(price.was, { compact: true })}</span> : null}
                </p>
              ) : null}
            </div>
          </div>
          {optionNames(product.variants).map((name) => (
            <fieldset key={name} className="mt-4">
              <legend className="mb-2 text-[13.5px] font-semibold text-ink-800">{word(name)}: <span className="font-normal text-ink-600">{selected[name] ? word(selected[name]) : null}</span></legend>
              <div className="flex flex-wrap gap-2">
                {optionValues(product.variants, name).map((value) => {
                  const active = selected[name] === value;
                  const available = isValueAvailable(product.variants, selected, name, value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSelected(selectValue(product.variants, selected, name, value))}
                      aria-pressed={active}
                      className={`min-w-12 rounded-xl border px-3.5 py-2 text-sm transition ${active ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-600' : 'border-ink-200 bg-white text-ink-800'} ${available ? '' : 'text-ink-400 line-through decoration-ink-300'}`}
                      data-testid="sheet-option"
                    >
                      {word(value)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <button type="button" onClick={add} disabled={busy || !variant?.inStock} className="btn-primary mt-5 h-12 w-full rounded-full text-[15px]" data-testid="sheet-add">
            {variant && !variant.inStock ? t('product.outOfStock') : t('search.addToCart')}
          </button>
          <Link href={paths.product(t.locale, slug)} className="mt-3 block text-center text-[13px] font-semibold text-brand-700" data-testid="sheet-details">{t('search.seeDetails')}</Link>
        </div>
      )}
    </Dialog>
  );
}
