import type { Metadata } from 'next';
import { TicketDetail } from './TicketDetail';

export const metadata: Metadata = { title: 'Ticket' };

export default async function Page({ params }: PageProps<'/tickets/[id]'>) {
  const { id } = await params;
  return <TicketDetail id={id} />;
}
