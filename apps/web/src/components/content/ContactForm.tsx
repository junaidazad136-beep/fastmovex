'use client';

import { CheckCircle2, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { EMAIL, Field, FormError } from '../auth/fields';
import { Spinner } from '../ui/Spinner';

const blank = { name: '', email: '', phone: '', subject: '', orderNumber: '', message: '', website: '' };

/** Message to the FastMoveX team (no account needed). The hidden "website" field catches bots. */
export function ContactForm({ order }: { order?: string }) {
  const t = useT();
  const { user } = useSession();
  const [f, setF] = useState({ ...blank, orderNumber: order ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (user) setF((x) => ({ ...x, name: x.name || user.fullName, email: x.email || user.email || '', phone: x.phone || user.phone || '' }));
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.name.trim().length < 2) errs.name = t('errors.required');
    if (!EMAIL.test(f.email.trim())) errs.email = t('errors.invalidEmail');
    if (f.message.trim().length < 10) errs.message = t('errors.minLength', { n: 10 });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    try {
      await api('/contact', {
        method: 'POST',
        auth: 'optional',
        body: {
          name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, subject: f.subject.trim() || undefined,
          orderNumber: f.orderNumber.trim() || undefined, message: f.message.trim(), website: f.website || undefined,
        },
      });
      setSentTo(f.email.trim());
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center" role="status" data-testid="contact-sent">
        <CheckCircle2 className="size-10 text-success-600" aria-hidden />
        <p className="font-medium">{t('contact.sent', { email: sentTo })}</p>
        <button type="button" className="btn-secondary" onClick={() => { setSentTo(null); setF({ ...blank, name: f.name, email: f.email, phone: f.phone }); }}>{t('contact.another')}</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6" noValidate data-testid="contact-form">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('contact.name')} error={errors.name}>
          {(a) => <input {...a} value={f.name} onChange={set('name')} className="input" autoComplete="name" maxLength={100} />}
        </Field>
        <Field label={t('contact.email')} error={errors.email}>
          {(a) => <input {...a} type="email" value={f.email} onChange={set('email')} className="input" autoComplete="email" dir="ltr" maxLength={200} />}
        </Field>
        <Field label={<>{t('contact.phone')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></>}>
          {(a) => <input {...a} type="tel" value={f.phone} onChange={set('phone')} className="input" autoComplete="tel" dir="ltr" maxLength={20} />}
        </Field>
        <Field label={<>{t('contact.orderNumber')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></>}>
          {(a) => <input {...a} value={f.orderNumber} onChange={set('orderNumber')} className="input uppercase" dir="ltr" maxLength={40} placeholder="FMX-QA-…" />}
        </Field>
      </div>
      <Field label={<>{t('contact.subject')} <span className="text-xs font-normal text-ink-400">({t('common.optional')})</span></>}>
        {(a) => <input {...a} value={f.subject} onChange={set('subject')} className="input" maxLength={150} />}
      </Field>
      <Field label={t('contact.message')} error={errors.message}>
        {(a) => <textarea {...a} value={f.message} onChange={set('message')} rows={6} maxLength={5000} placeholder={t('contact.messagePlaceholder')} className="input resize-y" />}
      </Field>
      {/* Honeypot: hidden from people and screen readers; bots fill it in */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-px w-px overflow-hidden">
        <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      </div>
      <button type="submit" disabled={busy} className="btn-primary" data-testid="contact-send">
        {busy ? <Spinner className="size-4" /> : <Send className="size-4" aria-hidden />}{busy ? t('contact.sending') : t('contact.send')}
      </button>
    </form>
  );
}
