'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import type { BuyAgainResult, Cart } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useCart } from '@/lib/state/cart';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';

/** Puts the order's items back in the cart (today's prices, what is in stock) and says what could not be added. */
export function BuyAgain({ orderNumber, className = 'btn-secondary w-full' }: { orderNumber: string; className?: string }) {
  const t = useT();
  const toast = useToast();
  const { setCart } = useCart();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await api<BuyAgainResult & { cart: Cart }>(`/orders/${encodeURIComponent(orderNumber)}/buy-again`, { method: 'POST' });
      setCart(r.cart);
      const units = r.added.reduce((n, a) => n + a.quantity, 0);
      const skipped = r.skipped.map((s) => s.title).slice(0, 3).join(', ');
      if (units > 0) {
        toast({ tone: 'success', message: t.plural('order.buyAgainDone', units) + (skipped ? ` · ${t('order.buyAgainSkipped', { items: skipped })}` : ''), action: { label: t('order.viewCart'), href: paths.cart(t.locale) } });
      } else if (r.skipped.length) {
        toast({ tone: 'error', message: t('order.buyAgainNone') });
      } else {
        toast({ tone: 'success', message: t('order.viewCart'), action: { label: t('order.viewCart'), href: paths.cart(t.locale) } }); // already all in the cart
      }
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={go} disabled={busy} className={className} data-testid="buy-again">
      {busy ? <Spinner className="size-4" /> : <RotateCcw className="size-4" aria-hidden />}{t('order.buyAgain')}
    </button>
  );
}
