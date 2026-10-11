import type { Metadata } from 'next';
import { PagesList } from './PagesList';

export const metadata: Metadata = { title: 'Pages' };

export default function Page() {
  return <PagesList />;
}
