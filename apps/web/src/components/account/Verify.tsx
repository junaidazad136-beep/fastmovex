'use client';

import { BadgeCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { paths, safeNext } from '@/lib/urls';
import { Field, FormError } from '../auth/fields';
import { Spinner } from '../ui/Spinner';

const COOLDOWN = 60;

/** Confirms the email or phone with the 6-digit code the API sent (at sign-up, or on request here). */
export function Verify() {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const params = useSearchParams();
  const channel = params.get('channel') === 'phone' ? 'phone' : 'email';
  const next = params.get('next') ? safeNext(params.get('next'), l) : paths.account(l);
  const { user, reload } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(params.get('next') ? COOLDOWN : 0); // coming from sign-up: a code was just sent
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    timer.current = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [wait]);

  const target = channel === 'email' ? user?.email : user?.phone;
  const verifiedAt = channel === 'email' ? user?.emailVerifiedAt : user?.phoneVerifiedAt;
  const channelLabel = channel === 'email' ? t('auth.verifyEmailChannel') : t('auth.verifyPhoneChannel');

  async function send() {
    setBusy(true); setError('');
    try {
      await api('/auth/verify/request', { method: 'POST', body: { channel } });
      setWait(COOLDOWN);
    } catch (e) { setError(errorMessage(e, t)); } finally { setBusy(false); }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError(t('errors.codeRule')); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/verify/confirm', { method: 'POST', body: { channel, code } });
      await reload();
      router.replace(next);
    } catch (err) { setError(errorMessage(err, t)); setBusy(false); }
  }

  if (!target) return null;
  if (verifiedAt) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <BadgeCheck className="mx-auto size-10 text-success-600" aria-hidden />
        <p className="mt-3 font-semibold">{t('auth.verifyDone')}</p>
        <Link href={next} className="btn-primary mt-6">{t('common.continue')}</Link>
      </div>
    );
  }
  return (
    <div className="card mx-auto max-w-md p-6 sm:p-8">
      <h1 className="text-xl font-bold">{t('auth.verifyTitle', { channel: channelLabel })}</h1>
      <p className="mt-1.5 text-sm text-ink-500">{t('auth.verifySubtitle', { target: `\u2066${target}\u2069` })}</p>
      <form onSubmit={confirm} className="mt-6 space-y-4" noValidate>
        <FormError message={error} />
        <Field label={t('auth.code')}>
          {(a) => <input {...a} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="input tabular text-center text-lg tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" dir="ltr" autoFocus data-testid="otp" />}
        </Field>
        <button type="submit" disabled={busy || code.length !== 6} className="btn-primary btn-lg w-full" data-testid="verify-submit">{busy && <Spinner />}{t('auth.verifySubmit')}</button>
        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={send} disabled={busy || wait > 0} className="link disabled:text-ink-400 disabled:no-underline">
            {wait > 0 ? t('auth.verifyResendIn', { seconds: wait }) : t('auth.verifyResend')}
          </button>
          <Link href={next} className="text-ink-500 hover:text-ink-800">{t('auth.verifyLater')}</Link>
        </div>
      </form>
    </div>
  );
}
