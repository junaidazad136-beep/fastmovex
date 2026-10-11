import type { Metadata } from 'next';
import { ReviewsList } from './ReviewsList';

export const metadata: Metadata = { title: 'Reviews' };

export default function Page() {
  return <ReviewsList />;
}
