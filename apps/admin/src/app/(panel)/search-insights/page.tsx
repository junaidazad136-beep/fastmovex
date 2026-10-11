import type { Metadata } from 'next';
import { SearchInsightsPage } from './SearchInsightsPage';

export const metadata: Metadata = { title: 'Search' };

export default function Page() {
  return <SearchInsightsPage />;
}
