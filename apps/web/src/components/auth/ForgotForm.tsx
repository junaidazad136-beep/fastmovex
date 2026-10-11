'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { Spinner } from '../ui/Spinner';
import { AuthCard, Field, FormError, normalizeIdentifier, PASSWORD_RULE, PasswordInput } from './fields';

/** Two steps on one page: ask for a code, then set a new password with it. Same answer whether or not the account exists. */
export function ForgotForm() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState<'ask' | 'reset'>('ask');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (identifier.trim().length < 3) { setFieldErr({ identifier: t('errors.required') }); return; }
    setBusy(true); setError(''); setFieldErr({});
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { identifier: normalizeIdentifier(identifier) }, auth: 'none' });
      setStep('reset');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!/^\d{6}$/.test(code.trim())) fe.code = t('errors.codeRule');
    if (!PASSWORD_RULE.test(password)) fe.password = t('errors.passwordRule');
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true); setError('');
    try {
      await api('/auth/password/reset', { method: 'POST', body: { identifier: normalizeIdentifier(identifier), code: code.trim(), newPassword: password }, auth: 'none' });
      router.replace(`/${t.locale}/login?reset=1`);
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }

  if (step === 'ask') {
    return (
      <AuthCard title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')}>
        <form onSubmit={ask} className="space-y-4" noValidate>
          <FormError message={error} />
          <Field label={t('auth.identifier')} error={fieldErr.identifier}>
            {(a) => <input {...a} value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="input" autoComplete="username" dir="ltr" autoCapitalize="none" />}
          </Field>
          <button type="submit" disabled={busy} className="btn-primary btn-lg w-full">{busy && <Spinner />}{t('auth.sendCode')}</button>
        </form>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('auth.resetTitle')} subtitle={t('auth.codeSent', { identifier: identifier.trim() })}>
      <form onSubmit={reset} className="space-y-4" noValidate>
        <FormError message={error} />
        <Field label={t('auth.code')} error={fieldErr.code}>
          {(a) => <input {...a} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="input tabular tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" dir="ltr" />}
        </Field>
        <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')} error={fieldErr.password}>
          {(a) => <PasswordInput {...a} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>
        <button type="submit" disabled={busy} className="btn-primary btn-lg w-full">{busy && <Spinner />}{t('auth.resetSubmit')}</button>
        <button type="button" onClick={() => setStep('ask')} className="btn-ghost w-full">{t('common.back')}</button>
      </form>
    </AuthCard>
  );
}
