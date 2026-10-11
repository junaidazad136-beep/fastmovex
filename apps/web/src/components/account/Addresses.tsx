'use client';

import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { Address } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/lib/state/toast';
import { Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/EmptyState';
import { AddressForm, formatAddress } from './AddressForm';

export function Addresses() {
  const t = useT();
  const toast = useToast();
  const [list, setList] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);

  const load = () => api<Address[]>('/addresses').then(setList).catch((e) => { setList([]); toast({ tone: 'error', message: errorMessage(e, t) }); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  async function act(fn: () => Promise<unknown>, msg: string) {
    try { await fn(); await load(); toast({ tone: 'success', message: msg }); } catch (e) { toast({ tone: 'error', message: errorMessage(e, t) }); }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('address.title')}</h1>
        <button type="button" onClick={() => setEditing('new')} className="btn-primary"><Plus className="size-4" aria-hidden />{t('address.add')}</button>
      </div>
      {list === null ? <div className="skeleton h-32" /> : list.length === 0 ? (
        <EmptyState icon={<MapPin className="size-7" aria-hidden />} title={t('address.empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <li key={a.id} className={`card p-4 text-sm ${a.isDefault ? 'ring-1 ring-brand-600' : ''}`}>
              <p className="flex items-center gap-2 font-semibold">{a.label ?? a.recipientName}{a.isDefault && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">{t('address.isDefault')}</span>}</p>
              <p className="mt-1 text-ink-600">{a.recipientName} · <span dir="ltr">{a.phone}</span></p>
              <p className="text-ink-500">{formatAddress(a, t)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(a)} className="btn-ghost px-2.5 py-1.5 text-xs"><Pencil className="size-3.5" aria-hidden />{t('common.edit')}</button>
                {!a.isDefault && <button type="button" onClick={() => act(() => api(`/addresses/${a.id}/default`, { method: 'POST' }), t('address.setDefault'))} className="btn-ghost px-2.5 py-1.5 text-xs">{t('address.makeDefault')}</button>}
                <button type="button" onClick={() => setDeleting(a)} className="btn-ghost px-2.5 py-1.5 text-xs text-danger-600"><Trash2 className="size-3.5" aria-hidden />{t('common.delete')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? t('address.add') : t('address.edit')} closeLabel={t('common.close')} wide>
        {editing !== null && (
          <AddressForm initial={editing === 'new' ? null : editing} onSaved={async () => { setEditing(null); await load(); toast({ tone: 'success', message: t('address.saved') }); }} onCancel={() => setEditing(null)} />
        )}
      </Dialog>
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t('address.deleteConfirm')} closeLabel={t('common.close')}>
        {deleting && <p className="text-sm text-ink-600">{formatAddress(deleting, t)}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" className="btn-danger flex-1" onClick={() => { const a = deleting!; setDeleting(null); void act(() => api(`/addresses/${a.id}`, { method: 'DELETE' }), t('address.deleted')); }}>{t('common.delete')}</button>
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>{t('common.cancel')}</button>
        </div>
      </Dialog>
    </div>
  );
}
