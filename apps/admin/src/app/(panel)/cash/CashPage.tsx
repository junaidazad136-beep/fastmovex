'use client';

import { Banknote, FileText, HandCoins } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, Checkbox, Dialog, EmptyState, ErrorState, MoneyField, NoAccess, PageHeader, SkeletonRows, Spinner, Stat, Table, Tabs, TextArea } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { decimalToMinor, formatDateTime, formatMoney, minorToDecimalString, timeAgo } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useUrlState } from '@/lib/use-api';

interface Holders {
  holders: { user: { id: string; fullName: string; phone: string | null; isDriver: boolean }; amountMinor: string; currencyCode: string; orders: number; since: string }[];
  today: { collectedMinor: string; collectedOrders: number; handedOverMinor: string; handovers: number; shortMinor: string; shortHandovers: number; withHoldersMinor: string };
  currencyCode: string;
}
interface Holder {
  user: { id: string; fullName: string; phone: string | null };
  open: { id: string; orderNumber: string; amountMinor: string; currencyCode: string; collectedAt: string }[];
  inHandMinor: string;
  currencyCode: string;
}
export interface Handover {
  id: string; number: string; createdAt: string; expectedMinor: string; receivedMinor: string; varianceMinor: string; currencyCode: string; note: string | null; orders: number;
  holder: { id: string; fullName: string }; receivedBy: { id: string; fullName: string };
}

export function varianceBadge(h: { varianceMinor: string; currencyCode: string }) {
  const v = BigInt(h.varianceMinor);
  if (v === 0n) return <Badge tone="green">Exact</Badge>;
  return v < 0n ? <Badge tone="red">Short {formatMoney((-v).toString(), h.currencyCode)}</Badge> : <Badge tone="amber">Over {formatMoney(h.varianceMinor, h.currencyCode)}</Badge>;
}

/**
 * Cash on delivery from the door to the cashier. Every delivered COD order is on the name of whoever holds the cash
 * (the driver, or staff who closed it). The cashier counts it here: expected vs counted, a shortage needs a note and
 * stays on record. Nobody can receive their own cash, and a handover can never be changed afterwards.
 */
export function CashPage() {
  const { can, user } = useSession();
  const [f, setF, ready] = useUrlState({ list: 'all' });
  const data = useApi<Holders>('/admin/cash/holders');
  const handovers = useApi<Handover[]>(ready ? `/admin/cash/handovers${qs({ shortOnly: f.list === 'short' ? true : undefined })}` : null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const { busy, run } = useAction();
  if (!can('cash.read')) return <NoAccess />;
  const cur = data.data?.currencyCode ?? 'QAR';
  const t = data.data?.today;

  const receipt = (h: { id: string; number: string }) => run(`r-${h.id}`, () => openPdf(`/admin/cash/handovers/${h.id}/receipt`, `${h.number}.pdf`));

  return (
    <>
      <PageHeader title="Cash on delivery" description="Who holds the company’s cash right now, and every handover to the cashier." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="cash-today">
        <Stat label="Collected today" value={t ? formatMoney(t.collectedMinor, cur) : '—'} sub={t ? `${t.collectedOrders} orders` : undefined} />
        <Stat label="Handed over today" value={t ? formatMoney(t.handedOverMinor, cur) : '—'} sub={t ? `${t.handovers} handovers` : undefined} />
        <Stat label="Short today" value={t ? formatMoney(t.shortMinor, cur) : '—'} sub={t?.shortHandovers ? `${t.shortHandovers} short handovers` : 'No shortages'} tone={t && t.shortMinor !== '0' ? 'danger' : undefined} />
        <Stat label="Still with people" value={t ? formatMoney(t.withHoldersMinor, cur) : '—'} tone={t && t.withHoldersMinor !== '0' ? 'warn' : undefined} />
      </div>

      <Card title="Who holds cash" description="Receive it when the driver comes back. Count the notes, then enter what you counted." bodyClassName="p-0">
        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Person</th><th className="th">Orders</th><th className="th">Oldest</th><th className="th text-end">Cash</th><th className="th text-end" /></tr></thead>
          <tbody>
            {!data.data && !data.error ? <SkeletonRows cols={5} rows={3} /> : null}
            {data.data?.holders.map((h) => (
              <tr key={h.user.id} className="hover:bg-ink-25" data-testid="cash-holder">
                <td className="td">
                  <p className="font-medium">{h.user.fullName} {h.user.isDriver ? <Badge tone="blue">Driver</Badge> : <Badge>Staff</Badge>}</p>
                  {h.user.phone ? <p className="text-xs text-ink-500" dir="ltr">{h.user.phone}</p> : null}
                </td>
                <td className="td tabular">{h.orders}</td>
                <td className="td text-ink-600" title={formatDateTime(h.since)}>{timeAgo(h.since)}</td>
                <td className="td text-end font-semibold tabular">{formatMoney(h.amountMinor, h.currencyCode)}</td>
                <td className="td text-end">
                  {can('cash.receive') && user?.id !== h.user.id
                    ? <button type="button" className="btn-primary btn-sm" onClick={() => setReceiving(h.user.id)}><HandCoins className="size-4" aria-hidden /> Receive</button>
                    : user?.id === h.user.id ? <span className="text-xs text-ink-500">Another person receives yours</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {data.data && !data.data.holders.length ? <EmptyState icon={<Banknote className="size-6" aria-hidden />} title="All cash is handed over" description="Nobody is holding cash on delivery money right now." /> : null}
      </Card>

      <Card title="Handovers" className="mt-6" bodyClassName="p-0">
        <Tabs value={f.list} onChange={(list) => setF({ list })} tabs={[{ value: 'all', label: 'All' }, { value: 'short', label: 'Short or over' }]} />
        {handovers.error ? <ErrorState error={handovers.error} onRetry={handovers.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Receipt</th><th className="th">From</th><th className="th">Received by</th><th className="th text-end">Expected</th><th className="th text-end">Counted</th><th className="th">Result</th><th className="th" /></tr></thead>
          <tbody>
            {!handovers.data && !handovers.error ? <SkeletonRows cols={7} rows={3} /> : null}
            {handovers.data?.map((h) => (
              <tr key={h.id} className="align-top hover:bg-ink-25" data-testid="handover-row">
                <td className="td"><p className="font-medium">{h.number}</p><p className="text-xs text-ink-500">{formatDateTime(h.createdAt)} · {h.orders} orders</p></td>
                <td className="td">{h.holder.fullName}</td>
                <td className="td">{h.receivedBy.fullName}</td>
                <td className="td text-end tabular">{formatMoney(h.expectedMinor, h.currencyCode)}</td>
                <td className="td text-end tabular">{formatMoney(h.receivedMinor, h.currencyCode)}</td>
                <td className="td">{varianceBadge(h)}{h.note ? <p className="mt-1 max-w-xs text-xs text-ink-500">{h.note}</p> : null}</td>
                <td className="td text-end"><button type="button" className="btn-ghost btn-sm" disabled={busy === `r-${h.id}`} onClick={() => receipt(h)}><FileText className="size-4" aria-hidden /> Receipt</button></td>
              </tr>
            ))}
          </tbody>
        </Table>
        {handovers.data && !handovers.data.length ? <EmptyState title="No handovers yet" /> : null}
      </Card>

      {receiving ? (
        <ReceiveDialog
          holderId={receiving}
          onClose={() => setReceiving(null)}
          onDone={(h) => { setReceiving(null); data.reload(); handovers.reload(); void receipt(h); }}
        />
      ) : null}
    </>
  );
}

function ReceiveDialog({ holderId, onClose, onDone }: { holderId: string; onClose: () => void; onDone: (h: Handover) => void }) {
  const holder = useApi<Holder>(`/admin/cash/holders/${holderId}`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  useEffect(() => { if (holder.data) setPicked(new Set(holder.data.open.map((o) => o.id))); }, [holder.data]);
  const cur = holder.data?.currencyCode ?? 'QAR';
  const expected = useMemo(() => (holder.data?.open ?? []).filter((o) => picked.has(o.id)).reduce((n, o) => n + BigInt(o.amountMinor), 0n), [holder.data, picked]);
  const countedMinor = counted.trim() ? decimalToMinor(counted) : null;
  const diff = countedMinor !== null ? BigInt(countedMinor) - expected : null;
  const needsNote = diff !== null && diff !== 0n;
  const valid = picked.size > 0 && countedMinor !== null && (!needsNote || note.trim().length >= 5);

  async function save() {
    if (!valid) return;
    const h = await run('receive', () => api<Handover>(`/admin/cash/holders/${holderId}/handover`, { method: 'POST', body: { collectionIds: [...picked], receivedMinor: countedMinor, note: note.trim() || undefined } }),
      (r) => (BigInt(r.varianceMinor) < 0n ? `Recorded ${r.number} — SHORT ${formatMoney((-BigInt(r.varianceMinor)).toString(), r.currencyCode)}` : `Recorded ${r.number}`));
    if (h) onDone(h);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={holder.data ? `Receive cash from ${holder.data.user.fullName}` : 'Receive cash'}
      description="Tick the orders you are counting now. Enter the amount you actually counted — never the expected amount."
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid || !!busy} onClick={save} data-testid="receive-cash">{busy ? <Spinner /> : null} Record handover</button>
        </>
      }
    >
      {holder.error ? <ErrorState error={holder.error} onRetry={holder.reload} /> : null}
      {!holder.data ? <Spinner /> : (
        <div className="space-y-4">
          <ul className="max-h-60 divide-y divide-ink-100 overflow-auto rounded-lg border border-ink-200" data-testid="cash-orders">
            {holder.data.open.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox checked={picked.has(o.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} aria-label={`Count ${o.orderNumber}`} />
                <span className="flex-1"><span className="font-medium">{o.orderNumber}</span><span className="ms-2 text-xs text-ink-500">{formatDateTime(o.collectedAt)}</span></span>
                <span className="tabular">{formatMoney(o.amountMinor, o.currencyCode)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
            <span>Expected for {picked.size} orders</span><span className="font-semibold tabular" data-testid="cash-expected">{formatMoney(expected.toString(), cur)}</span>
          </div>
          <MoneyField label="Cash counted" currency={cur} value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={minorToDecimalString(expected)} inputMode="decimal" data-testid="cash-counted" />
          {diff !== null ? (
            diff === 0n
              ? <p className="text-sm text-success-700">Matches exactly.</p>
              : <p className="text-sm font-medium text-danger-600" data-testid="cash-diff">{diff < 0n ? `Short by ${formatMoney((-diff).toString(), cur)}` : `Over by ${formatMoney(diff.toString(), cur)}`} — explain it below.</p>
          ) : null}
          {needsNote ? <TextArea label="Note (required)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} placeholder="e.g. Driver says he gave change; will bring 10 QAR tomorrow" /> : null}
        </div>
      )}
    </Dialog>
  );
}
