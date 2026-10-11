import type { Metadata } from 'next';
import { StockCountsPage } from './StockCountsPage';

export const metadata: Metadata = { title: 'Stocktake' };

export default function Page() {
  return <StockCountsPage />;
}
