import type { Metadata } from 'next';
import { QuestionsList } from './QuestionsList';

export const metadata: Metadata = { title: 'Product questions' };

export default function Page() {
  return <QuestionsList />;
}
