import type { Metadata } from 'next';
import { ProductLoader } from './ProductLoader';

export const metadata: Metadata = { title: 'Product' };

export default async function Page({ params }: PageProps<'/products/[id]'>) {
  const { id } = await params;
  return <ProductLoader id={id} />;
}
