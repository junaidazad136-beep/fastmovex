import type { Metadata } from 'next';
import { ReturnsList } from './ReturnsList';

export const metadata: Metadata = { title: 'Returns' };

export default function Page() {
  return <ReturnsList />;
}
