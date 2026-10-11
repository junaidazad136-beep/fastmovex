import type { Metadata } from 'next';
import { HomePageEditor } from './HomePageEditor';

export const metadata: Metadata = { title: 'Home page' };

export default function Page() {
  return <HomePageEditor />;
}
