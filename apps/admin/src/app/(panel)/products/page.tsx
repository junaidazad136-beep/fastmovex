import type { Metadata } from 'next';
import { ProductsList } from './ProductsList';

export const metadata: Metadata = { title: 'Products' };

export default function Page() {
  return <ProductsList />;
}
