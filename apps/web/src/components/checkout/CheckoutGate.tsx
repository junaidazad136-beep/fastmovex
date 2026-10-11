'use client';

import { RequireAuth } from '../auth/RequireAuth';
import { useSession } from '@/lib/state/session';
import { useShop } from '@/lib/state/shop';
import { Checkout } from './Checkout';
import { GuestCheckout } from './GuestCheckout';

/** Signed in: the saved-address checkout. Not signed in: guest checkout when the market allows it, else sign-in. */
export function CheckoutGate() {
  const { status } = useSession();
  const { market } = useShop();
  if (status === 'user') return <Checkout />;
  if (status === 'guest' && market.guestCheckout) return <GuestCheckout />;
  if (status === 'guest') return <RequireAuth><Checkout /></RequireAuth>;
  return <div className="space-y-4" aria-busy="true"><div className="skeleton h-8 w-56" /><div className="skeleton h-40" /><div className="skeleton h-40" /></div>;
}
