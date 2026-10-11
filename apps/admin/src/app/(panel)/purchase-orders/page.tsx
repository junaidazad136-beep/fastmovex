import type { Metadata } from 'next';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';

export const metadata: Metadata = { title: 'Purchase orders' };

export default function Page() {
  return <PurchaseOrdersPage />;
}
