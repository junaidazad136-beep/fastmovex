import { EditProduct } from '@/components/seller/ProductForm';

export default async function SellerProductPage({ params }: PageProps<'/[locale]/seller/products/[id]'>) {
  const { id } = await params;
  return <EditProduct id={id} />;
}
