import type { Metadata } from 'next';
import { PurchaseOrderDetail } from './PurchaseOrderDetail';

export const metadata: Metadata = { title: 'Purchase order' };

export default async function Page({ params }: PageProps<'/purchase-orders/[id]'>) {
  const { id } = await params;
  return <PurchaseOrderDetail id={id} />;
}
