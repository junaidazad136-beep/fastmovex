'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { OrderItem } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { shrinkPhoto } from '@/lib/image';
import { useToast } from '@/lib/state/toast';
import { FormError } from '../auth/fields';
import { Dialog } from '../ui/Dialog';
import { Spinner } from '../ui/Spinner';

/** "Faulty — use the warranty": what is wrong, with photos. Shown after the first 7 days, while the warranty runs. */
export function WarrantyDialog({ orderNumber, item, onClose, onDone }: { orderNumber: string; item: OrderItem | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(''); setPhotos([]); setError(''); }, [item]);
  if (!item) return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 10) { setError(t('errors.minLength', { n: 10 })); return; }
    if (!photos.length) { setError(t('warranty.photosNeeded')); return; }
    setBusy(true); setError('');
    try {
      const c = await api<{ id: string }>(`/orders/${encodeURIComponent(orderNumber)}/warranty`, { method: 'POST', body: { orderItemId: item!.id, description: text.trim() } });
      let failed = false;
      for (const f of photos) {
        const form = new FormData();
        form.append('file', await shrinkPhoto(f), f.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg');
        await api(`/me/warranty/${c.id}/photos`, { method: 'POST', body: form }).catch(() => { failed = true; });
      }
      if (failed) toast({ tone: 'error', message: t('warranty.photoFailed') });
      toast({ tone: 'success', message: t('warranty.sent') });
      onDone();
    } catch (err) { setError(errorMessage(err, t)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!item} onClose={onClose} title={t('warranty.title', { title: item.productTitle })} closeLabel={t('common.close')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <p className="text-sm text-ink-600">{t('warranty.intro')}</p>
        {item.warrantyEndsOn && <p className="hint">{t('warranty.until', { date: formatDate(item.warrantyEndsOn, t.locale) })}</p>}
        <label className="block">
          <span className="label">{t('warranty.what')}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} className="input" placeholder={t('warranty.placeholder')} data-testid="warranty-text" />
        </label>
        <label className="block">
          <span className="label">{t('warranty.photos')}</span>
          <input type="file" accept="image/*" multiple className="input" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 5))} data-testid="warranty-photos" />
        </label>
        <p className="hint">{t('warranty.notCovered')}</p>
        <button type="submit" disabled={busy} className="btn-primary w-full" data-testid="warranty-submit">{busy && <Spinner className="size-4" />}{t('warranty.submit')}</button>
      </form>
    </Dialog>
  );
}
