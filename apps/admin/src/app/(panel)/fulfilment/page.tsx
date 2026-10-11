import type { Metadata } from 'next';
import { FulfilmentPage } from './FulfilmentPage';

export const metadata: Metadata = { title: 'Picking & packing' };

export default function Page() {
  return <FulfilmentPage />;
}
