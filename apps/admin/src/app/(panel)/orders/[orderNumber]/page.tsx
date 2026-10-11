import type { Metadata } from 'next';
import { OrderDetail } from './OrderDetail';

export async function generateMetadata({ params }: PageProps<'/orders/[orderNumber]'>): Promise<Metadata> {
  const { orderNumber } = await params;
  return { title: decodeURIComponent(orderNumber) };
}

export default async function Page({ params }: PageProps<'/orders/[orderNumber]'>) {
  const { orderNumber } = await params;
  return <OrderDetail orderNumber={decodeURIComponent(orderNumber)} />;
}
