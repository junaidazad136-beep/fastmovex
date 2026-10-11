import type { Metadata } from 'next';
import { CartView } from '@/components/cart/CartView';
import { getT } from '@/lib/i18n';
import { isLocale } from '@/lib/i18n/config';

export async function generateMetadata({ params }: PageProps<'/[locale]/cart'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getT(locale)('cart.title'), robots: { index: false, follow: false } };
}

export default function CartPage() {
  return <CartView />;
}
