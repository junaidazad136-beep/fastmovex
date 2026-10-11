import type { Metadata } from 'next';
import { PageEditor } from './PageEditor';

export const metadata: Metadata = { title: 'Page' };

export default async function Page({ params }: PageProps<'/pages/[id]'>) {
  const { id } = await params;
  return <PageEditor id={id} />;
}
