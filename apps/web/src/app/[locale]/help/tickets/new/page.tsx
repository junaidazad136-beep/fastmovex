import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { NewTicket } from '@/components/help/Tickets';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NewTicketPage() {
  return <div className="container-page py-8"><Suspense><RequireAuth><NewTicket /></RequireAuth></Suspense></div>;
}
