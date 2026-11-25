'use client';

import { useT } from '@/lib/i18n/client';
import { Spinner } from '../ui/Spinner';

/**
 * Phones: the total and "Place order" stay at the bottom of the screen while the customer fills the form
 * (the summary card with the same button is at the very end of a long page). Hidden from tablet width up.
 */
export function PayBar({ total, busy, disabled, error, onClick }: { total: string; busy: boolean; disabled: boolean; error?: React.ReactNode; onClick?: () => void }) {
  const t = useT();
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-6px_20px_rgba(20,16,31,0.06)] backdrop-blur lg:hidden" data-testid="pay-bar">
      {error && <p className="mb-2 line-clamp-2 text-xs font-medium text-danger-600" role="alert">{error}</p>}
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-500">{t('cart.total')}</p>
          <p className="tabular text-lg font-bold leading-tight text-ink-900">{total}</p>
        </div>
        <button type={onClick ? 'button' : 'submit'} onClick={onClick} disabled={disabled || busy} className="btn-primary btn-lg ms-auto flex-1" data-testid="pay-bar-place">
          {busy && <Spinner />}{busy ? t('checkout.placing') : t('checkout.placeOrder')}
        </button>
      </div>
    </div>
  );
}
