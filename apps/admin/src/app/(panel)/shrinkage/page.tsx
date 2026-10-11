import type { Metadata } from 'next';
import { ShrinkagePage } from './ShrinkagePage';

export const metadata: Metadata = { title: 'Losses' };

export default function Page() {
  return <ShrinkagePage />;
}
