'use client';

import { usePathname } from 'next/navigation';

/** Pages where people look for products. Account, cart, seller, help, login… have no use for the search bar. */
export const BROWSE_ROUTE = /^\/(en|ar)(\/(search|c|categories|offers|brand|store|p)(\/|$)|\/?$)/;

/** `desktop`: the bar inside the main header row (keeps its space so the icons stay at the end). `mobile`: the row under the logo. */
export function SearchSlot({ where, children }: { where: 'desktop' | 'mobile'; children: React.ReactNode }) {
  const show = BROWSE_ROUTE.test(usePathname());
  if (where === 'desktop') return <div className="hidden flex-1 md:block">{show ? children : null}</div>;
  return show ? <div className="container-page pb-3 md:hidden">{children}</div> : null;
}
