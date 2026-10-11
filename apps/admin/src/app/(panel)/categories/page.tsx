import type { Metadata } from 'next';
import { CategoriesPage } from './CategoriesPage';

export const metadata: Metadata = { title: 'Categories' };

export default function Page() {
  return <CategoriesPage />;
}
