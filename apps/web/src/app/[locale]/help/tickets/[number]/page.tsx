import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { TicketThread } from '@/components/help/Tickets';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function TicketPage({ params }: PageProps<'/[locale]/help/tickets/[number]'>) {
  const { number } = await params;
  return <div className="container-page py-8"><Suspense><RequireAuth><TicketThread number={decodeURIComponent(number)} /></RequireAuth></Suspense></div>;
}
