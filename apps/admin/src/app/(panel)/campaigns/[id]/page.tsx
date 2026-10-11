import type { Metadata } from 'next';
import { CampaignDetail } from './CampaignDetail';

export const metadata: Metadata = { title: 'Flash sale' };

export default async function Page({ params }: PageProps<'/campaigns/[id]'>) {
  const { id } = await params;
  return <CampaignDetail id={id} />;
}
