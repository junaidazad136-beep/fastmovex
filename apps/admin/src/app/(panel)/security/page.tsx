import type { Metadata } from 'next';
import { SecurityPage } from './SecurityPage';

export const metadata: Metadata = { title: 'My security' };

export default function Page() {
  return <SecurityPage />;
}
