import type { Metadata, Viewport } from 'next';
import { DriverApp } from './DriverApp';

export const metadata: Metadata = { title: 'Deliveries today' };
export const viewport: Viewport = { themeColor: '#7422E6', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function Page() {
  return <DriverApp />;
}
