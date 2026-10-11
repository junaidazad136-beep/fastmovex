import type { Metadata } from 'next';
import { BrandsPage } from './BrandsPage';

export const metadata: Metadata = { title: 'Brands' };

export default function Page() {
  return <BrandsPage />;
}
