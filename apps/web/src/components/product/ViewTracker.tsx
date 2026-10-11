'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/state/session';

/** Counts a product view (and fills "Recently viewed" for signed-in shoppers). Once per product per page view. */
export function ViewTracker({ slug }: { slug: string }) {
  const { status } = useSession();
  useEffect(() => { track('product_view'); }, [slug]);
  useEffect(() => {
    if (status === 'loading') return;
    api(`/products/${encodeURIComponent(slug)}`, { auth: 'optional' }).catch(() => {});
  }, [slug, status]);
  return null;
}
