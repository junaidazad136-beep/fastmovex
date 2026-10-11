'use client';

import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { paths, safeNext } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';
import { SocialButtons } from './SocialButtons';
import { AuthCard, Field, FormError, normalizeIdentifier, normalizeOtp, PasswordInput, RECOVERY_CODE } from './fields';

export function LoginForm({ nextParam, reset, expired }: { nextParam?: string; reset?: boolean; expired?: boolean }) {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const next = safeNext(nextParam, l);
  const { status, login, loginWithCode } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // two-step sign-in: the challenge from the password step, then the authenticator (or recovery) code
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [identityLabel, setIdentityLabel] = useState('');
  const notice = reset ? t('auth.resetDone') : expired ? t('auth.sessionExpired') : '';

  useEffect(() => { if (status === 'user' && !busy) router.replace(next); }, [status, busy, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) { setError(t('errors.required')); return; }
    setBusy(true);
    setError('');
    try {
      const r = await login(normalizeIdentifier(identifier), password);
      if ('twoFactorRequired' in r) {
        setIdentityLabel('');
        setChallenge(r.challenge);
        setCode('');
        setRecovery(false);
        setBusy(false);
        return;
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('auth.invalid') : errorMessage(err, t));
      setBusy(false);
    }
  }

  function backToPassword(message = '') {
    setChallenge(null);
    setCode('');
    setRecovery(false);
    setPassword('');
    setError(message);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    const value = normalizeOtp(code, recovery);
    if (recovery ? !RECOVERY_CODE.test(value) : !/^\d{6}$/.test(value)) {
      setError(recovery ? t('auth.twoFactor.recoveryRule') : t('errors.codeRule'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await loginWithCode(challenge, value);
      router.replace(next);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) {
        if (err.reason === 'BAD_CODE') { setError(t('auth.twoFactor.badCode')); setCode(''); }
        else backToPassword(t('auth.twoFactor.expired')); // CHALLENGE_EXPIRED: start again with the password
        return;
      }
      setError(errorMessage(err, t));
    }
  }

  if (challenge) {
    return (
      <AuthCard title={t('auth.twoFactor.title')} subtitle={t('auth.twoFactor.subtitle')}>
        <form onSubmit={submitCode} className="space-y-4" noValidate data-testid="two-factor-form">
          <div className="flex items-center gap-3 rounded-xl bg-brand-50/70 px-3.5 py-3 text-sm text-ink-700">
            <ShieldCheck className="size-5 shrink-0 text-brand-600" aria-hidden />
            <span className="min-w-0 truncate" dir="ltr">{identityLabel || normalizeIdentifier(identifier)}</span>
          </div>
          <FormError message={error} />
          {recovery ? (
            <Field key="recovery" label={t('auth.twoFactor.recoveryLabel')} hint={t('auth.twoFactor.recoveryHint')}>
              {(a) => (
                <input {...a} name="recoveryCode" value={code} onChange={(e) => setCode(normalizeOtp(e.target.value, true))} className="input font-mono uppercase tracking-widest"
                  autoComplete="off" autoCapitalize="characters" spellCheck={false} dir="ltr" maxLength={12} placeholder="XXXX-XXXX" autoFocus required data-testid="two-factor-code" />
              )}
            </Field>
          ) : (
            <Field key="totp" label={t('auth.twoFactor.codeLabel')} hint={t('auth.twoFactor.codeHint')}>
              {(a) => (
                <input {...a} name="code" value={code} onChange={(e) => setCode(normalizeOtp(e.target.value))} className="input text-center font-mono text-xl tracking-[0.5em]"
                  inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" dir="ltr" maxLength={6} autoFocus required data-testid="two-factor-code" />
              )}
            </Field>
          )}
          <button type="submit" disabled={busy} className="btn-primary btn-lg w-full" data-testid="two-factor-submit">
            {busy && <Spinner />}{busy ? t('auth.twoFactor.verifying') : t('auth.twoFactor.submit')}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <button type="button" onClick={() => backToPassword()} className="link inline-flex items-center gap-1" data-testid="two-factor-back">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t('auth.twoFactor.back')}
            </button>
            <button type="button" onClick={() => { setRecovery((r) => !r); setCode(''); setError(''); }} className="link" data-testid="two-factor-toggle">
              {recovery ? t('auth.twoFactor.useApp') : t('auth.twoFactor.useRecovery')}
            </button>
          </div>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {notice && <p className="rounded-xl bg-success-50 px-3.5 py-2.5 text-sm font-medium text-success-700" role="status">{notice}</p>}
        <FormError message={error} />
        <Field label={t('auth.identifier')} hint={t('auth.identifierHint')}>
          {(a) => <input {...a} name="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="input" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} dir="ltr" required />}
        </Field>
        <Field label={<span className="flex items-center justify-between">{t('auth.password')}<Link href={`/${l}/forgot-password`} className="link text-xs font-medium">{t('auth.forgot')}</Link></span>}>
          {(a) => <PasswordInput {...a} name="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
        </Field>
        <button type="submit" disabled={busy} className="btn-primary btn-lg w-full" data-testid="login-submit">
          {busy && <Spinner />}{busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      <SocialButtons
        onDone={() => { setBusy(true); router.replace(next); }}
        onChallenge={(c) => { setIdentityLabel(t('auth.social.twoStep')); setChallenge(c.challenge); setCode(''); setRecovery(false); setError(''); }}
      />
      <p className="mt-6 text-center text-sm text-ink-600">
        {t('auth.noAccount')} <Link href={paths.register(l, nextParam)} className="link">{t('auth.createAccount')}</Link>
      </p>
    </AuthCard>
  );
}
