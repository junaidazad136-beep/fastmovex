import type { Metadata } from 'next';
import { SizeChartsPage } from './SizeChartsPage';

export const metadata: Metadata = { title: 'Size guides' };

export default function Page() {
  return <SizeChartsPage />;
}
