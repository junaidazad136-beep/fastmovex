'use client';

import { Heart } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useWishlist } from '@/lib/state/wishlist';
import { paths } from '@/lib/urls';
import { haptic } from '@/lib/haptics';

export function WishlistButton({ productId, compact = false, className }: { productId: string; compact?: boolean; className?: string }) {
  const t = useT();
  const { status } = useSession();
  const wishlist = useWishlist();
  const toast = useToast();
  const pathname = usePathname();
  const busy = useRef(false);
  const [popKey, setPopKey] = useState(0);
  const saved = wishlist.has(productId);

  /** the heart fills (or empties) the moment it is tapped; the wishlist puts it back if the server says no */
  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (status !== 'user') {
      toast({ tone: 'info', message: t('product.signInToSave'), action: { label: t('nav.signIn'), href: paths.login(t.locale, pathname) } });
      return;
    }
    if (busy.current) return; // a double tap while the first is on its way
    busy.current = true;
    haptic('tap');
    if (!saved) setPopKey((k) => k + 1);
    try {
      const now = await wishlist.toggle(productId);
      toast({ tone: 'success', message: now ? t('product.savedToWishlist') : t('product.removedFromWishlist') });
    } catch (err) {
      haptic('error');
      toast({ tone: 'error', message: errorMessage(err, t) });
    } finally {
      busy.current = false;
    }
  }

  const label = saved ? t('product.removeFromWishlist') : t('product.saveToWishlist');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'loading'}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={className ?? (compact ? 'pcard-fav' : 'btn-secondary size-12 shrink-0 p-0')}
    >
      <Heart key={popKey} className={`size-[18px] ${saved ? 'fill-brand-600 text-brand-600' : ''} ${popKey ? 'pop' : ''}`} aria-hidden />
    </button>
  );
}
