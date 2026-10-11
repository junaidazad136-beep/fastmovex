import type { Metadata } from 'next';
import { CustomerDetail } from './CustomerDetail';

export const metadata: Metadata = { title: 'Customer' };

export default async function Page({ params }: PageProps<'/customers/[id]'>) {
  const { id } = await params;
  return <CustomerDetail id={id} />;
}
