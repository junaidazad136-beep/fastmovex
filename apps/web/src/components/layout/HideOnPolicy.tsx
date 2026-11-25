'use client';

import { usePathname } from 'next/navigation';

/** A policy opens as a document viewer: on a phone the shop's header and footer stay out of the way, so only the pages show. */
export const POLICY_ROUTE = /^\/(en|ar)\/(terms|privacy|seller-policy|help\/returns)(\/|$)/;

export function HideOnPolicy({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (POLICY_ROUTE.test(pathname)) return <div className="max-lg:hidden">{children}</div>;
  return <>{children}</>;
}
