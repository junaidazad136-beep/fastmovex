'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useShop } from '@/lib/state/shop';
import { paths, safeNext } from '@/lib/urls';
import { Spinner } from '../ui/Spinner';
import { SocialButtons } from './SocialButtons';
import { AuthCard, E164, EMAIL, Field, FormError, normalizePhone, PASSWORD_RULE, PasswordInput } from './fields';
import { PolicyLinks } from '../content/PolicyLinks';

export function RegisterForm({ nextParam }: { nextParam?: string }) {
  const t = useT();
  const l = t.locale;
  const router = useRouter();
  const next = safeNext(nextParam, l);
  const { market } = useShop();
  const { register } = useSession();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<React.ReactNode>('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (form.fullName.trim().length < 2) e.fullName = t('errors.minLength', { n: 2 });
    if (mode === 'email' && !EMAIL.test(form.email.trim())) e.email = t('errors.invalidEmail');
    if (mode === 'phone' && !E164.test(normalizePhone(form.phone))) e.phone = t('errors.invalidPhone');
    if (!PASSWORD_RULE.test(form.password)) e.password = t('errors.passwordRule');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setError('');
    try {
      await register({
        fullName: form.fullName.trim(),
        ...(mode === 'email' ? { email: form.email.trim().toLowerCase() } : { phone: normalizePhone(form.phone) }),
        password: form.password,
        locale: l,
        countryCode: market.code,
      });
      // A verification code was sent to the new address; confirming it is optional but recommended.
      router.replace(`/${l}/account/verify?channel=${mode}&next=${encodeURIComponent(next)}`);
    } catch (err) {
      // Ordered as a guest before: the reset code proves the email is theirs, then their orders are in the account.
      if (err instanceof ApiError && err.reason === 'GUEST_ACCOUNT') {
        setError(<>{t('auth.guestAccount')} <Link href={paths.forgot(l)} className="link">{t('auth.forgot')}</Link></>);
      } else {
        setError(errorMessage(err, t));
      }
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.registerTitle')} subtitle={t('auth.registerSubtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Field label={t('auth.fullName')} error={errors.fullName}>
          {(a) => <input {...a} value={form.fullName} onChange={set('fullName')} className="input" autoComplete="name" required maxLength={100} />}
        </Field>
        {mode === 'email' ? (
          <Field label={<span className="flex items-center justify-between">{t('auth.email')}<button type="button" onClick={() => setMode('phone')} className="link text-xs">{t('auth.usePhone')}</button></span>} error={errors.email}>
            {(a) => <input {...a} type="email" value={form.email} onChange={set('email')} className="input" autoComplete="email" dir="ltr" required maxLength={254} />}
          </Field>
        ) : (
          <Field label={<span className="flex items-center justify-between">{t('auth.phone')}<button type="button" onClick={() => setMode('email')} className="link text-xs">{t('auth.useEmail')}</button></span>} hint={t('auth.phoneHint')} error={errors.phone}>
            {(a) => <input {...a} type="tel" value={form.phone} onChange={set('phone')} className="input" autoComplete="tel" dir="ltr" placeholder="+974" required />}
          </Field>
        )}
        <Field label={t('auth.password')} hint={t('auth.passwordHint')} error={errors.password}>
          {(a) => <PasswordInput {...a} value={form.password} onChange={set('password')} autoComplete="new-password" required />}
        </Field>
        <button type="submit" disabled={busy} className="btn-primary btn-lg w-full" data-testid="register-submit">
          {busy && <Spinner />}{busy ? t('auth.creating') : t('auth.createAccount')}
        </button>
        <p className="text-center text-xs text-ink-500">{t('auth.terms')} <PolicyLinks /></p>
      </form>
      <SocialButtons onDone={() => router.replace(next)} />
      <p className="mt-6 text-center text-sm text-ink-600">
        {t('auth.haveAccount')} <Link href={paths.login(l, nextParam)} className="link">{t('auth.signIn')}</Link>
      </p>
    </AuthCard>
  );
}
