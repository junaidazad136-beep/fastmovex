import type { Metadata } from 'next';
import { MarginReport } from './MarginReport';

export const metadata: Metadata = { title: 'Profit & margin' };

export default function Page() {
  return <MarginReport />;
}
