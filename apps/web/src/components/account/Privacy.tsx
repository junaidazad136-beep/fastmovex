'use client';

import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, downloadFile } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { DeletionStatus } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { paths } from '@/lib/urls';
import { FormError, PasswordInput } from '../auth/fields';
import { Spinner } from '../ui/Spinner';

/**
 * Your data (Qatar personal data law): download everything FastMoveX holds about you, or ask to delete the account —
 * done after a waiting period, during which signing in and choosing "Keep my account" cancels it.
 */
export function Privacy() {
  const t = useT();
  const l = t.locale;
  const toast = useToast();
  const { logout } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState('');
  const [blockers, setBlockers] = useState<DeletionStatus['blockers']>([]);

  async function exportData() {
    setBusy('export');
    try { await downloadFile('/me/data-export', 'fastmovex-my-data.json'); toast({ tone: 'success', message: t('privacy.exported') }); }
    catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
    finally { setBusy(null); }
  }

  async function startDelete() {
    setOpen(true); setErr('');
    try { setBlockers((await api<DeletionStatus>('/me/deletion')).blockers); } catch { /* shown on submit */ }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!sure) return;
    setBusy('delete'); setErr('');
    try {
      const r = await api<{ deleteOn: string }>('/me/deletion', { method: 'POST', body: { password: password || undefined, reason: reason.trim() || undefined } });
      toast({ tone: 'success', message: t('privacy.scheduled', { date: formatDate(r.deleteOn, l) }) });
      await logout(); // the API signed this account out everywhere
      window.location.assign(paths.home(l));
    } catch (e2) {
      if (e2 instanceof ApiError && e2.reason === 'OPEN_ACTIVITY') setBlockers((e2.body?.blockers as DeletionStatus['blockers']) ?? []);
      setErr(e2 instanceof ApiError && e2.reason === 'BAD_PASSWORD' ? t('privacy.badPassword') : e2 instanceof ApiError && e2.reason === 'OPEN_ACTIVITY' ? t('privacy.blocked') : errorMessage(e2, t));
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-4 p-5" aria-labelledby="acc-privacy" data-testid="privacy">
      <h2 id="acc-privacy" className="flex items-center gap-2 font-bold"><ShieldCheck className="size-4 text-brand-600" aria-hidden />{t('privacy.title')}</h2>
      <div>
        <p className="text-sm text-ink-600">{t('privacy.exportHint')}</p>
        <button type="button" className="btn-secondary mt-3" disabled={!!busy} onClick={exportData} data-testid="export-data">
          {busy === 'export' ? <Spinner /> : <Download className="size-4" aria-hidden />}{t('privacy.export')}
        </button>
      </div>
      <div className="border-t border-ink-100 pt-4">
        <p className="text-sm text-ink-600">{t('privacy.deleteHint', { days: 14 })}</p>
        {!open ? (
          <button type="button" className="btn-danger mt-3" onClick={startDelete} data-testid="delete-account">
            <Trash2 className="size-4" aria-hidden />{t('privacy.delete')}
          </button>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-3 rounded-2xl border border-danger-600/20 bg-danger-50/40 p-4" data-testid="delete-form" noValidate>
            {blockers.length > 0 && (
              <ul className="space-y-1 rounded-xl bg-white px-3 py-2 text-sm text-warning-600" data-testid="delete-blockers">
                {blockers.map((b) => <li key={b.reason}>{t.plural(`privacy.blocker.${b.reason}`, b.count)}</li>)}
              </ul>
            )}
            <ul className="list-disc space-y-1 ps-5 text-sm text-ink-700">
              <li>{t('privacy.what1')}</li>
              <li>{t('privacy.what2')}</li>
              <li>{t('privacy.what3', { days: 14 })}</li>
            </ul>
            <label className="block text-sm">
              <span className="label">{t('account.currentPassword')}</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <label className="block text-sm">
              <span className="label">{t('privacy.reason')}</span>
              <textarea className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-danger-600" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="delete-sure" />
              <span>{t('privacy.understand')}</span>
            </label>
            <FormError message={err} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-danger" disabled={!sure || !!busy || blockers.length > 0} data-testid="delete-confirm">{busy === 'delete' ? <Spinner /> : null}{t('privacy.confirm')}</button>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

/** Shown on every account page while a deletion is scheduled: the date, and a way to keep the account. */
export function DeletionBanner() {
  const t = useT();
  const l = t.locale;
  const toast = useToast();
  const { user, reload } = useSession();
  const [busy, setBusy] = useState(false);
  if (!user?.deletion) return null;
  async function keep() {
    setBusy(true);
    try { await api('/me/deletion', { method: 'DELETE' }); await reload(); toast({ tone: 'success', message: t('privacy.kept') }); }
    catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
    finally { setBusy(false); }
  }
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-warning-600/30 bg-warning-50 p-4 text-sm" role="alert" data-testid="deletion-banner">
      <p className="flex-1">{t('privacy.pending', { date: formatDate(user.deletion.deleteOn, l) })}</p>
      <button type="button" className="btn-primary" disabled={busy} onClick={keep} data-testid="keep-account">{busy ? <Spinner /> : null}{t('privacy.keep')}</button>
    </div>
  );
}
