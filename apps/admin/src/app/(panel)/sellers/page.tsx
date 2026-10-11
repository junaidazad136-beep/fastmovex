import type { Metadata } from 'next';
import { SellersPage } from './SellersPage';

export const metadata: Metadata = { title: 'Sellers' };

export default function Page() {
  return <SellersPage />;
}
