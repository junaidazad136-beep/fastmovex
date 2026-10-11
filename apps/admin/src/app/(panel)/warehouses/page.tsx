import type { Metadata } from 'next';
import { WarehousesPage } from './WarehousesPage';

export const metadata: Metadata = { title: 'Warehouses' };

export default function Page() {
  return <WarehousesPage />;
}
