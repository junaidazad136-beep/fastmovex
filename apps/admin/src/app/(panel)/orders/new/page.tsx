import type { Metadata } from 'next';
import { PhoneOrder } from './PhoneOrder';

export const metadata: Metadata = { title: 'Phone order' };

export default function Page() {
  return <PhoneOrder />;
}
