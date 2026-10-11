import type { Metadata } from 'next';
import { CampaignsPage } from './CampaignsPage';

export const metadata: Metadata = { title: 'Flash sales' };

export default function Page() {
  return <CampaignsPage />;
}
