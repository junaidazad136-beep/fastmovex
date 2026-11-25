'use client';

import { usePathname } from 'next/navigation';

/** Checkout is a focused page (like big shops do): no footer links pulling the customer away from paying. */
export function HideOnCheckout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (/^\/(en|ar)\/checkout(\/|$)/.test(pathname)) return null;
  return <>{children}</>;
}
