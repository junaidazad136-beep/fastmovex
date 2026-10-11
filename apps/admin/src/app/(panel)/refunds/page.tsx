import type { Metadata } from 'next';
import { RefundsList } from './RefundsList';

export const metadata: Metadata = { title: 'Refunds' };

export default function Page() {
  return <RefundsList />;
}
