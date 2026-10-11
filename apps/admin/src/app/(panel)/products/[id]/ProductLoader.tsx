'use client';

import Link from 'next/link';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import { isNotFound } from '@/lib/api/errors';
import { useApi } from '@/lib/use-api';
import { ProductEditor, type ProductDetail } from '../ProductEditor';

export function ProductLoader({ id }: { id: string }) {
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const p = useApi<ProductDetail>(valid ? `/admin/products/${id}` : null);
  if (!valid || isNotFound(p.error)) return <EmptyState title="Product not found" description="It may have been deleted." action={<Link href="/products" className="btn-secondary">Back to products</Link>} />;
  if (p.error) return <ErrorState error={p.error} onRetry={p.reload} />;
  if (!p.data) return <Loading />;
  return <ProductEditor product={p.data} onReload={p.reload} />;
}
