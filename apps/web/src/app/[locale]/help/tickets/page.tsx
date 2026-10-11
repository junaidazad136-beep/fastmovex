import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { TicketList } from '@/components/help/Tickets';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function TicketsPage() {
  return <div className="container-page py-8"><Suspense><RequireAuth><TicketList /></RequireAuth></Suspense></div>;
}
