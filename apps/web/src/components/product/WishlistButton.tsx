'use client';

import { Heart } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useWishlist } from '@/lib/state/wishlist';
import { paths } from '@/lib/urls';

export function WishlistButton({ productId, compact = false }: { productId: string; compact?: boolean }) {
  const t = useT();
  const { status } = useSession();
  const wishlist = useWishlist();
  const toast = useToast();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const saved = wishlist.has(productId);

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (status !== 'user') {
      toast({ tone: 'info', message: t('product.signInToSave'), action: { label: t('nav.signIn'), href: paths.login(t.locale, pathname) } });
      return;
    }
    setBusy(true);
    try {
      const now = await wishlist.toggle(productId);
      toast({ tone: 'success', message: now ? t('product.savedToWishlist') : t('product.removedFromWishlist') });
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const label = saved ? t('product.removeFromWishlist') : t('product.saveToWishlist');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || status === 'loading'}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={
        compact
          ? 'pcard-fav'
          : 'btn-secondary size-12 shrink-0 p-0'
      }
    >
      <Heart className={`size-[18px] ${saved ? 'fill-brand-600 text-brand-600' : ''}`} aria-hidden />
    </button>
  );
}
