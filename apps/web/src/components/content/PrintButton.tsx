'use client';

import { Printer } from 'lucide-react';

/** Opens the browser's print window: "Save as PDF" there gives an A4 copy of the document. */
export function PrintButton({ label, icon }: { label: string; icon?: boolean }) {
  if (icon) {
    return (
      <button type="button" onClick={() => window.print()} aria-label={label} title={label} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white hover:bg-white/10" data-testid="policy-print-icon">
        <Printer className="size-[18px]" aria-hidden />
      </button>
    );
  }
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary !px-3.5 !py-2 text-sm" data-testid="policy-print">
      <Printer className="size-4" aria-hidden />{label}
    </button>
  );
}
