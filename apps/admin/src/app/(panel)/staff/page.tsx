import type { Metadata } from 'next';
import { StaffPage } from './StaffPage';

export const metadata: Metadata = { title: 'Staff' };

export default function Page() {
  return <StaffPage />;
}
