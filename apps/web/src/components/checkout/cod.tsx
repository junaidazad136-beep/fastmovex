'use client';

import { CheckCircle2, MessageSquareText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { Market } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import type { T } from '@/lib/i18n';
import { Spinner } from '../ui/Spinner';

/** Is cash on delivery offered for this basket? (The API checks again; this only avoids a dead end.) */
export function codAvailability(market: Market, totalMinor: string | undefined, guest: boolean): { ok: true } | { ok: false; why: 'limit' | 'signIn'; maxMinor?: string } {
  const r = market.cod;
  if (!r) return { ok: true };
  if (r.maxOrderMinor && totalMinor && BigInt(totalMinor) > BigInt(r.maxOrderMinor)) return { ok: false, why: 'limit', maxMinor: r.maxOrderMinor };
  if (guest && !r.guestAvailable) return { ok: false, why: 'signIn' };
  return { ok: true };
}

export const COD_REASONS = ['COD_LIMIT', 'COD_BLOCKED', 'COD_OPEN_ORDERS', 'COD_PHONE_UNVERIFIED', 'COD_PHONE_CODE', 'COD_NEEDS_SMS', 'SMS_OFF'] as const;

/** The shopper's language for the API's cash-on-delivery refusals. */
export function codErrorMessage(e: unknown, t: T, money: (m: string) => string): string {
  const reason = e instanceof ApiError ? e.reason : undefined;
  switch (reason) {
    case 'COD_LIMIT': {
      const max = e instanceof ApiError && typeof e.body?.maxOrderMinor === 'string' ? e.body.maxOrderMinor : null;
      return max ? t('cod.limit', { amount: money(max) }) : t('cod.limitGeneric');
    }
    case 'COD_BLOCKED': return t('cod.blocked');
    case 'COD_OPEN_ORDERS': return t('cod.openOrders');
    case 'COD_PHONE_UNVERIFIED': return t('cod.verifyAccountPhone');
    case 'COD_PHONE_CODE': return t('cod.codeWrong');
    case 'COD_NEEDS_SMS':
    case 'SMS_OFF': return t('cod.noSms');
    default: return errorMessage(e, t);
  }
}

/**
 * Guest cash on delivery: the mobile number is confirmed with a texted 6-digit code before the order is placed.
 * `contact` returns the details to send (null while they are not filled in yet).
 */
export function GuestPhoneCheck({ t, contact, code, onCode, verified, onVerified, invalid }: {
  t: T;
  contact: () => { fullName: string; email: string; phone: string; locale: string } | null;
  code: string;
  onCode: (v: string) => void;
  verified: boolean;
  onVerified: (v: boolean) => void;
  invalid?: string;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  async function send() {
    const c = contact();
    if (!c) { setError(t('cod.fillDetailsFirst')); return; }
    setBusy(true); setError('');
    try {
      const r = await api<{ required: boolean; verified?: boolean; sentTo?: string }>('/checkout/guest/phone-code', { method: 'POST', auth: 'none', body: c });
      if (!r.required) { onVerified(true); return; }
      setSentTo(r.sentTo ?? c.phone);
      setWait(60);
      window.setTimeout(() => document.getElementById('gc-phone-code')?.focus(), 50);
    } catch (e) {
      const retry = e instanceof ApiError && typeof e.body?.retryAfterSeconds === 'number' ? e.body.retryAfterSeconds : 0;
      if (retry) setWait(retry);
      setError(codErrorMessage(e, t, (m) => m));
    } finally { setBusy(false); }
  }

  if (verified) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-xl bg-success-50 px-3.5 py-2.5 text-sm text-success-700" data-testid="cod-phone-verified">
        <CheckCircle2 className="size-4" aria-hidden />{t('cod.phoneConfirmed')}
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-ink-200 bg-ink-25 p-3.5" data-testid="cod-phone-check">
      <p className="flex items-start gap-2 text-sm text-ink-700"><MessageSquareText className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />{t('cod.whyCode')}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {sentTo && (
          <div className="min-w-0 flex-1">
            <label htmlFor="gc-phone-code" className="label">{t('cod.codeLabel', { phone: sentTo })}</label>
            <input
              id="gc-phone-code" value={code} onChange={(e) => onCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} placeholder="••••••"
              className="input max-w-[12rem] font-mono tracking-[0.3em]" aria-invalid={!!invalid || undefined} aria-describedby={invalid ? 'gc-phone-code-err' : undefined}
            />
          </div>
        )}
        <button type="button" onClick={send} disabled={busy || wait > 0} className="btn-secondary" data-testid="cod-send-code">
          {busy && <Spinner className="size-4" />}{sentTo ? (wait > 0 ? t('cod.resendIn', { s: wait }) : t('cod.resend')) : t('cod.sendCode')}
        </button>
      </div>
      {(invalid || error) && <p id="gc-phone-code-err" className="mt-2 text-sm text-danger-600" role="alert">{invalid || error}</p>}
    </div>
  );
}
