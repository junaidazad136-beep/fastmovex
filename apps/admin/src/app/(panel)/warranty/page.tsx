import type { Metadata } from 'next';
import { WarrantyList } from './WarrantyList';

export const metadata: Metadata = { title: 'Warranty' };

export default function Page() {
  return <WarrantyList />;
}
