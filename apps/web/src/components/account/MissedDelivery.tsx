'use client';

import { CheckCircle2, MessageSquareText, PackageX, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { DeliveryAttempt, RescheduleResult } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { FormError } from '../auth/fields';
import { SLOT_REASONS, SlotPicker, useDeliverySlots } from '../checkout/SlotPicker';
import { Spinner } from '../ui/Spinner';

export const NOTE_MAX = 300;

/** Body for POST …/reschedule: a new window and/or a note. `null` when there is nothing to send. */
export function rescheduleBody(slot: string, note: string): { deliverySlot?: string; note?: string } | null {
  const n = note.trim().slice(0, NOTE_MAX);
  if (!slot && !n) return null;
  return { ...(slot ? { deliverySlot: slot } : {}), ...(n ? { note: n } : {}) };
}

/**
 * A missed delivery: why the driver could not deliver, when, and — unless the order was refused at the door —
 * a form to choose a new delivery window and/or leave a note for the driver.
 * Signed-in customers post to /orders/:n/reschedule, guests to /orders/guest/:n/reschedule with their order token.
 */
export function MissedDelivery({ attempt, request, orderNumber, guestToken, canAct, onSaved }: {
  attempt: DeliveryAttempt;
  request: { text: string; at: string | null } | null | undefined;
  orderNumber: string;
  guestToken?: string;
  /** Only one shipment of an order can be rearranged at a time (the API takes the first missed one). */
  canAct: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const l = t.locale;
  const refused = attempt.kind === 'REFUSED' || !attempt.canReschedule;
  const [open, setOpen] = useState(!request);
  const [saved, setSaved] = useState<string | null>(null);
  const shownRequest = saved ?? request?.text ?? null;

  return (
    <div className="border-b border-warning-600/20 bg-warning-50 px-4 py-4" data-testid="missed-delivery">
      <div className="flex items-start gap-3">
        {refused ? <PackageX className="mt-0.5 size-6 shrink-0 text-warning-600" aria-hidden /> : <TriangleAlert className="mt-0.5 size-6 shrink-0 text-warning-600" aria-hidden />}
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-ink-900">{t('order.missed.title')}</h3>
          <p className="mt-0.5 text-sm text-ink-700" data-testid="missed-reason">{t(`order.missed.kind.${attempt.kind ?? 'OTHER'}`)}</p>
          {attempt.failedAt && <p className="mt-0.5 text-xs text-ink-500">{t('order.missed.at', { date: formatDateTime(attempt.failedAt, l) })}</p>}
          {refused && <p className="mt-2 text-sm text-ink-700">{t('order.missed.refused')}</p>}
        </div>
      </div>

      {!refused && saved && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-success-50 px-3.5 py-2.5 text-sm font-medium text-success-700" role="status" data-testid="reschedule-done">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />{t('order.missed.done')}
        </p>
      )}
      {!refused && shownRequest && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm text-ink-800 ring-1 ring-warning-600/15" data-testid="customer-request">
          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
          <span className="min-w-0 break-words">{t('order.missed.request', { text: shownRequest })}</span>
        </p>
      )}

      {!refused && canAct && (open ? (
        <RescheduleForm
          orderNumber={orderNumber}
          guestToken={guestToken}
          onCancel={shownRequest ? () => setOpen(false) : undefined}
          onSaved={(text) => { setSaved(text); setOpen(false); onSaved(); }}
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary mt-3 px-3 py-1.5 text-sm" data-testid="reschedule-change">{t('order.missed.change')}</button>
      ))}
    </div>
  );
}

function RescheduleForm({ orderNumber, guestToken, onCancel, onSaved }: { orderNumber: string; guestToken?: string; onCancel?: () => void; onSaved: (request: string) => void }) {
  const t = useT();
  const { data: slots, reload: reloadSlots } = useDeliverySlots();
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = rescheduleBody(slot, note);
    if (!body) { setError(t('order.missed.needOne')); return; }
    setBusy(true);
    setError('');
    try {
      const path = guestToken ? `/orders/guest/${encodeURIComponent(orderNumber)}/reschedule` : `/orders/${encodeURIComponent(orderNumber)}/reschedule`;
      const opts = guestToken ? { auth: 'none' as const, headers: { 'x-order-token': guestToken } } : {};
      const res = await api<RescheduleResult>(path, { ...opts, method: 'POST', body });
      setBusy(false);
      onSaved(res?.request ?? body.note ?? '');
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && (SLOT_REASONS as readonly string[]).includes(err.reason ?? '')) {
        setSlot('');
        reloadSlots();
        setError(t('slot.taken'));
      } else setError(errorMessage(err, t));
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4" noValidate data-testid="reschedule-form">
      <p className="text-sm font-medium text-ink-800">{t('order.missed.intro')}</p>
      <FormError message={error} />
      <SlotPicker data={slots} value={slot} onChange={setSlot} />
      <label className="block">
        <span className="label">{t('order.missed.noteLabel')}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} rows={2} maxLength={NOTE_MAX} placeholder={t('order.missed.notePlaceholder')} className="input bg-white" data-testid="reschedule-note" />
        <span className="hint flex justify-between gap-3"><span>{t('order.missed.noteHint')}</span><span className="tabular shrink-0" dir="ltr">{note.length}/{NOTE_MAX}</span></span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="btn-primary" data-testid="reschedule-submit">{busy && <Spinner className="size-4" />}{t('order.missed.submit')}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary">{t('order.missed.keep')}</button>}
      </div>
    </form>
  );
}
