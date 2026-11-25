'use client';

import { Printer } from 'lucide-react';

/** Opens the browser's print window: "Save as PDF" there gives an A4 copy of the document. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary !px-3.5 !py-2 text-sm" data-testid="policy-print">
      <Printer className="size-4" aria-hidden />{label}
    </button>
  );
}
