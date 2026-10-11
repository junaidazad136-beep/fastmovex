import type { Metadata } from 'next';
import { ProductEditor } from '../ProductEditor';

export const metadata: Metadata = { title: 'Add product' };

export default function Page() {
  return <ProductEditor product={null} />;
}
