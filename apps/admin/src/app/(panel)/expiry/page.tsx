import type { Metadata } from 'next';
import { ExpiryPage } from './ExpiryPage';

export const metadata: Metadata = { title: 'Expiry dates' };

export default function Page() {
  return <ExpiryPage />;
}
