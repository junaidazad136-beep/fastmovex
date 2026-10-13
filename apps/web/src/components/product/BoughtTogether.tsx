'use client';

import { Check, Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { TogetherCard } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { paths, pick } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';
import { effectivePrice } from './Price';

interface Line { key: string; variantId: string; title: string; label?: string | null; imageUrl: string | null; priceMinor: string; href: string | null; main: boolean }

/**
 * Amazon's "Frequently bought together": this item plus up to two others customers ordered with it, each with a tick
 * box, the total, and one button that puts them all in the cart. Items with options add the one priced here, and say
 * which ("Black / 128 GB").
 */
export function BoughtTogether({ main, items }: {
  main: { variantId: string; title: string; imageUrl: string | null; priceMinor: string } | null;
  items: TogetherCard[];
}) {
  const t = useT();
  const money = useMoney();
  const cart = useCart();
  const toast = useToast();
  const others = items.filter((c) => c.inStock && c.variantId).slice(0, 2);
  const lines: Line[] = [
    ...(main ? [{ key: 'main', ...main, href: null, main: true }] : []),
    ...others.map((c) => ({
      key: c.id, variantId: c.variantId, title: pick(t.locale, c.title, c.titleAr), label: c.variantLabel, imageUrl: c.imageUrl,
      priceMinor: effectivePrice(c).now, href: paths.product(t.locale, c.slug), main: false,
    })),
  ];
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  if (!main || !others.length) return null;

  const chosen = lines.filter((l) => !off.has(l.key));
  const total = chosen.reduce((s, l) => s + BigInt(l.priceMinor), 0n);
  const toggle = (key: string) => setOff((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  async function addAll() {
    setState('busy');
    try {
      // one after another: a guest's first add creates the cart the next ones go into
      for (const l of chosen) await cart.add(l.variantId, 1);
      setState('done');
      toast({ tone: 'success', message: t('product.addedAll'), action: { label: t('product.viewCart'), href: paths.cart(t.locale) } });
      window.setTimeout(() => setState('idle'), 2500);
    } catch (e) {
      setState('idle');
      toast({ tone: 'error', message: errorMessage(e, t) });
    }
  }

  return (
    <section className="mt-8 border-t border-ink-100 pt-6 lg:col-span-2" aria-labelledby="bought-together" data-testid="bought-together">
      <h2 id="bought-together" className="section-title mb-4">{t('product.boughtTogether')}</h2>
      <div className="lg:flex lg:items-start lg:gap-10">
        {/* the pictures with "+" between them */}
        <ol className="flex items-center gap-1.5 sm:gap-3" aria-hidden>
          {lines.map((l, i) => (
            <li key={l.key} className="flex items-center gap-1.5 sm:gap-3">
              {i > 0 && <Plus className="size-4 shrink-0 text-ink-400" />}
              <span className={`relative block size-[88px] shrink-0 overflow-hidden rounded-xl bg-ink-50 ring-1 ring-ink-100 transition-opacity sm:size-28 ${off.has(l.key) ? 'opacity-35' : ''}`}>
                {l.imageUrl && <Image src={l.imageUrl} alt="" fill sizes="112px" className="object-contain p-1.5" />}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-4 min-w-0 flex-1 lg:mt-0 lg:max-w-xl">
          <ul className="space-y-2.5">
            {lines.map((l) => (
              <li key={l.key}>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-5">
                  <input
                    type="checkbox"
                    checked={!off.has(l.key)}
                    onChange={() => toggle(l.key)}
                    className="mt-0.5 size-[18px] shrink-0 accent-brand-600"
                    data-testid="together-check"
                  />
                  <span className="min-w-0">
                    {l.main && <strong className="font-bold text-ink-900">{t('product.thisItem')} </strong>}
                    {l.href
                      ? <Link href={l.href} className="text-brand-700 hover:underline">{l.title}</Link>
                      : <span className="text-ink-800">{l.title}</span>}
                    {l.label && <span className="text-ink-500"> · <bdi>{l.label}</bdi></span>}
                    {' '}<span className="tabular whitespace-nowrap font-bold text-ink-900">{money(l.priceMinor)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <p className="text-sm text-ink-700">
              {t('product.totalPrice')} <span className="tabular text-lg font-bold text-ink-900" data-testid="together-total">{money(total)}</span>
            </p>
            <button
              type="button"
              onClick={addAll}
              disabled={!chosen.length || state === 'busy'}
              className="btn-primary h-11 rounded-full px-5 max-sm:w-full"
              data-testid="together-add"
            >
              {state === 'busy' ? <Spinner /> : state === 'done' ? <Check className="size-5" aria-hidden /> : null}
              {state === 'done'
                ? t('product.added')
                : chosen.length === lines.length ? t('product.addAllToCart', { count: chosen.length }) : t('product.addSelectedToCart', { count: chosen.length })}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
