import type { Metadata } from 'next';
import { CouponsPage } from './CouponsPage';

export const metadata: Metadata = { title: 'Coupons' };

export default function Page() {
  return <CouponsPage />;
}
