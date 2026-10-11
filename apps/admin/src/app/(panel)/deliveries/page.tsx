import type { Metadata } from 'next';
import { DeliveriesPage } from './DeliveriesPage';

export const metadata: Metadata = { title: 'Deliveries' };

export default function Page() {
  return <DeliveriesPage />;
}
