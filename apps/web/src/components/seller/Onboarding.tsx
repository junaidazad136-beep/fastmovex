'use client';

import { CheckCircle2, Circle, Clock, Send, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { Spinner } from '../ui/Spinner';
import { Field } from './BecomeSeller';
import { BankForm, LogoBlock, UploadButton } from './StoreForms';
import type { SellerMe } from './types';

/** The seller application: CR number, CR document, bank account, logo — then "Send for review". */
export function Onboarding({ me, reload }: { me: SellerMe; reload: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [cr, setCr] = useState(me.commercialRegNo ?? '');
  const [busy, setBusy] = useState<'' | 'cr' | 'send'>('');
  const editable = me.status === 'PENDING' || me.status === 'REJECTED';
  const crDocs = me.documents.filter((d) => d.type === 'COMMERCIAL_REGISTRATION');
  const done = {
    cr: !!me.commercialRegNo,
    doc: crDocs.some((d) => d.status !== 'REJECTED'),
    bank: !!me.ibanLast4,
  };
  const ready = done.cr && done.doc && done.bank;

  async function saveCr(e: React.FormEvent) {
    e.preventDefault();
    setBusy('cr');
    try {
      await api('/seller/me', { method: 'PATCH', body: { commercialRegNo: cr.trim() } });
      toast({ tone: 'success', message: t('seller.onboarding.saved') });
      await reload();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(''); }
  }
  async function send() {
    setBusy('send');
    try {
      await api('/seller/me/submit', { method: 'POST' });
      toast({ tone: 'success', message: t('seller.onboarding.sent') });
      await reload();
    } catch (err) { toast({ tone: 'error', message: errorMessage(err, t) }); } finally { setBusy(''); }
  }

  const tone = me.status === 'UNDER_REVIEW' ? 'bg-sky-50 text-sky-800' : me.status === 'PENDING' ? 'bg-brand-50 text-brand-800' : 'bg-danger-50 text-danger-600';
  const StatusIcon = me.status === 'UNDER_REVIEW' ? Clock : me.status === 'PENDING' ? Circle : ShieldAlert;
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="seller-onboarding">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('seller.onboarding.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{me.store?.name ?? me.businessName}</p>
      </div>
      <div className={`flex items-start gap-3 rounded-2xl p-4 ${tone}`} role="status" data-testid="seller-status">
        <StatusIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">{t(`seller.onboarding.status.${me.status}`)}</p>
          {me.status === 'REJECTED' && me.rejectionReason && <p className="mt-1">{t('seller.onboarding.reason', { reason: me.rejectionReason })}</p>}
        </div>
      </div>

      {me.status !== 'SUSPENDED' && (
        <ol className="space-y-3">
          <Step n={1} title={t('seller.onboarding.stepCr')} done={done.cr}>
            <form onSubmit={saveCr} className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <Field id="ob-cr" label={t('seller.onboarding.stepCr')}><input id="ob-cr" className="input" dir="ltr" value={cr} onChange={(e) => setCr(e.target.value)} disabled={!editable} minLength={3} maxLength={40} /></Field>
              </div>
              {editable && <button type="submit" className="btn-secondary" disabled={busy === 'cr' || cr.trim().length < 3 || cr.trim() === me.commercialRegNo}>{busy === 'cr' && <Spinner />}{t('seller.onboarding.save')}</button>}
            </form>
          </Step>
          <Step n={2} title={t('seller.onboarding.stepDoc')} done={done.doc}>
            {crDocs.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {crDocs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${d.status === 'APPROVED' ? 'bg-success-50 text-success-700' : d.status === 'REJECTED' ? 'bg-danger-50 text-danger-600' : 'bg-ink-100 text-ink-700'}`}>{t(`seller.onboarding.docStatus.${d.status}`)}</span>
                    <span className="text-ink-500">{new Date(d.createdAt).toLocaleDateString(t.locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB')}</span>
                    {d.note && <span className="text-ink-600">· {d.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            {editable && <UploadButton path="/seller/me/documents" extra={{ type: 'COMMERCIAL_REGISTRATION' }} accept="image/jpeg,image/png,image/webp,application/pdf" label={t('seller.onboarding.upload')} onDone={reload} testId="cr-upload" />}
          </Step>
          <Step n={3} title={t('seller.onboarding.stepBank')} done={done.bank}>
            <BankForm me={me} onSaved={reload} />
          </Step>
          <Step n={4} title={t('seller.onboarding.stepLogo')} done={!!me.store?.logoUrl} optional>
            <LogoBlock me={me} onDone={reload} />
          </Step>
        </ol>
      )}

      {editable && (
        <button type="button" onClick={send} className="btn-primary btn-lg w-full sm:w-auto" disabled={!ready || busy === 'send'} data-testid="seller-submit">
          {busy === 'send' ? <Spinner /> : <Send className="size-5 rtl:rotate-180" aria-hidden />}{t('seller.onboarding.send')}
        </button>
      )}
    </div>
  );
}

function Step({ n, title, done, optional, children }: { n: number; title: string; done: boolean; optional?: boolean; children: React.ReactNode }) {
  const t = useT();
  return (
    <li className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-3">
        {done ? <CheckCircle2 className="size-6 shrink-0 text-success-600" aria-hidden /> : <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">{n}</span>}
        <h2 className="flex-1 font-semibold text-ink-900">{title}</h2>
        {!optional && <span className={`text-xs font-semibold ${done ? 'text-success-700' : 'text-ink-500'}`}>{done ? t('seller.onboarding.done') : t('seller.onboarding.todo')}</span>}
      </div>
      {children}
    </li>
  );
}
