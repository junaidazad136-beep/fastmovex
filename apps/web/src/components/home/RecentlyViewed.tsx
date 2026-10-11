'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ProductCard as Card } from '@/lib/api/types';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useShop } from '@/lib/state/shop';
import { ProductCard } from '../product/ProductCard';
import { Rail } from '../ui/Rail';

/** Personal rail, loaded in the browser so the rest of the home page can be cached for everyone. */
export function RecentlyViewed() {
  const t = useT();
  const { status } = useSession();
  const { market } = useShop();
  const [items, setItems] = useState<Card[]>([]);
  useEffect(() => {
    if (status !== 'user') { setItems([]); return; }
    api<Card[]>('/me/recently-viewed').then(setItems).catch(() => setItems([]));
  }, [status]);
  if (!items.length) return null;
  const title = t('home.recently_viewed');
  return (
    <section className="container-page mt-10" aria-label={title}>
      <h2 className="section-title mb-4">{title}</h2>
      <Rail label={title} prevLabel={t('common.previous')} nextLabel={t('common.next')}>
        {items.map((p) => (
          <li key={p.id} className="rail-item">
            <ProductCard p={p} t={t} minorUnits={market.currency.minorUnits} />
          </li>
        ))}
      </Rail>
    </section>
  );
}
