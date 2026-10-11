import type { Metadata } from 'next';
import { StockCountDetail } from './StockCountDetail';

export const metadata: Metadata = { title: 'Stocktake' };

export default async function Page({ params }: PageProps<'/stock-counts/[id]'>) {
  const { id } = await params;
  return <StockCountDetail id={id} />;
}
