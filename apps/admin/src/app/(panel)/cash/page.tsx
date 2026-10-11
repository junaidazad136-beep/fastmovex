import type { Metadata } from 'next';
import { CashPage } from './CashPage';

export const metadata: Metadata = { title: 'Cash on delivery' };

export default function Page() {
  return <CashPage />;
}
