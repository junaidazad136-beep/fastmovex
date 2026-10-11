import type { Metadata } from 'next';
import { ImportExport } from './ImportExport';

export const metadata: Metadata = { title: 'Import / export' };

export default function Page() {
  return <ImportExport />;
}
