import type { Metadata } from 'next';
import { TranslationPage } from './TranslationPage';

export const metadata: Metadata = { title: 'Arabic translation' };

export default function Page() {
  return <TranslationPage />;
}
