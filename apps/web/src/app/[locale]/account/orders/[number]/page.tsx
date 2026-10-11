import { OrderDetailView } from '@/components/account/OrderDetail';

export default async function OrderPage({ params, searchParams }: PageProps<'/[locale]/account/orders/[number]'>) {
  const { number } = await params;
  const sp = await searchParams;
  return <OrderDetailView number={decodeURIComponent(number)} placed={sp.placed === '1'} />;
}
