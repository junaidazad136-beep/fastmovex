import type { Metadata } from 'next';
import { TicketsList } from './TicketsList';

export const metadata: Metadata = { title: 'Support tickets' };

export default function Page() {
  return <TicketsList />;
}
