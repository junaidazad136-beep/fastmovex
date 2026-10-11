import type { Metadata } from 'next';
import { TrafficPage } from './TrafficPage';

export const metadata: Metadata = { title: 'Traffic & funnel' };

export default function Page() {
  return <TrafficPage />;
}
