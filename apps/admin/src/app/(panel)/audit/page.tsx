import type { Metadata } from 'next';
import { AuditPage } from './AuditPage';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return <AuditPage />;
}
