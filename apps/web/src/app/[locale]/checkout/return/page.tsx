import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PaymentReturnGate } from '@/components/checkout/PaymentReturn';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PaymentReturnPage() {
  return (
    <div className="container-page py-16">
      <Suspense><PaymentReturnGate /></Suspense>
    </div>
  );
}
