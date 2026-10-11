import type { Metadata } from 'next';
import { SettingsPage } from './SettingsPage';

export const metadata: Metadata = { title: 'Store & delivery' };

export default function Page() {
  return <SettingsPage />;
}
