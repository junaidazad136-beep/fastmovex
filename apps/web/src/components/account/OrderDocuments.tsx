'use client';

import { FileText, Receipt, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { downloadFile } from '@/lib/api/client';
import type { OrderDocuments as Docs } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useMoney } from '@/lib/state/shop';
import { useToast } from '@/lib/state/toast';
import { Spinner } from '../ui/Spinner';

/**
 * Downloads for one order: the invoice (in the page's language), a credit note for every refund paid and a receipt
 * for every returned item that was checked. Guests download with their order link's token.
 */
export function OrderDocuments({ docs, orderNumber, currency, guestToken }: { docs: Docs; orderNumber: string; currency: string; guestToken?: string }) {
  const t = useT();
  const l = t.locale;
  const money = useMoney();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const base = guestToken ? `/orders/guest/${encodeURIComponent(orderNumber)}` : `/orders/${encodeURIComponent(orderNumber)}`;
  const opts = guestToken ? { auth: 'none' as const, headers: { 'x-order-token': guestToken } } : {};

  async function get(key: string, path: string, name: string) {
    setBusy(key);
    try { await downloadFile(`${base}${path}`, name, opts); }
    catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
    finally { setBusy(null); }
  }
  if (!docs.invoice && !docs.creditNotes.length && !docs.returnReceipts.length) return null;

  const row = 'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-ink-50 disabled:opacity-60';
  return (
    <section className="card p-4 text-sm" data-testid="order-documents">
      <h2 className="mb-2 font-bold">{t('docs.title')}</h2>
      <ul className="-mx-2.5 space-y-0.5">
        {docs.invoice && (
          <li>
            <button type="button" className={row} disabled={!!busy} onClick={() => get('inv', `/invoice.pdf?lang=${l}`, `FastMoveX-invoice-${orderNumber}.pdf`)} data-testid="download-invoice">
              {busy === 'inv' ? <Spinner /> : <FileText className="size-4 text-brand-600" aria-hidden />}
              <span className="flex-1 font-medium">{t('docs.invoice')}</span>
              <span className="text-xs text-ink-400">PDF</span>
            </button>
          </li>
        )}
        {docs.creditNotes.map((c) => (
          <li key={c.id}>
            <button type="button" className={row} disabled={!!busy} onClick={() => get(c.id, `/credit-notes/${c.id}.pdf`, `${c.number}.pdf`)} data-testid="download-credit-note">
              {busy === c.id ? <Spinner /> : <Receipt className="size-4 text-brand-600" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t('docs.creditNote')} <span dir="ltr" className="text-ink-500">{c.number}</span></span>
                <span className="block text-xs text-ink-500">{formatDate(c.at, l)} · −{money(c.amountMinor, { currency })}</span>
              </span>
              <span className="text-xs text-ink-400">PDF</span>
            </button>
          </li>
        ))}
        {docs.returnReceipts.map((r) => (
          <li key={r.id}>
            <button type="button" className={row} disabled={!!busy} onClick={() => get(r.id, `/return-receipts/${r.id}.pdf`, `${r.number}.pdf`)} data-testid="download-return-receipt">
              {busy === r.id ? <Spinner /> : <RotateCcw className="size-4 text-brand-600" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t('docs.returnReceipt')}</span>
                <span className="block truncate text-xs text-ink-500">{formatDate(r.at, l)} · {r.title}</span>
              </span>
              <span className="text-xs text-ink-400">PDF</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
