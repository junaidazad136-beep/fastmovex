import { SellerOrderView } from '@/components/seller/OrderView';

export default async function SellerOrderPage({ params }: PageProps<'/[locale]/seller/orders/[id]'>) {
  const { id } = await params;
  return <SellerOrderView id={id} />;
}
