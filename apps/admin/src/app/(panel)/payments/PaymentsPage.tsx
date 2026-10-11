'use client';

import { AlertTriangle, CheckCircle2, FileText, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, Spinner, Stat, StatusBadge, Table, Tabs } from '@/components/ui';
import { api, openPdf } from '@/lib/api/client';
import { formatDateTime, formatMoney, paymentMethodLabel, timeAgo, todayInQatar } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { qs, useAction, useApi, useCursorList, useUrlState, type ApiState } from '@/lib/use-api';

type Kind = 'CANCELLED_NOT_REFUNDED' | 'DELIVERED_NOT_PAID' | 'AMOUNT_MISMATCH' | 'CARD_PENDING' | 'COD_NO_COLLECTION' | 'CASH_NOT_HANDED_OVER';
interface Exception { kind: Kind; orderNumber: string; orderStatus: string; paymentId: string | null; method: string | null; provider: string | null; amountMinor: string; currencyCode: string; detail: string; since: string }
interface Exceptions { counts: Record<Kind, number>; items: Exception[] }
interface Settlement {
  id: string; provider: string; fileName: string; currencyCode: string; rows: number; matched: number; mismatched: number; missing: number; extra: number; fileTotalMinor: string; createdAt: string;
  result?: {
    lines: { line: number; reference: string; fileAmountMinor: string; joviaAmountMinor: string | null; orderNumber: string | null; status: string | null; result: string; note?: string }[];
    extra: { reference: string | null; orderNumber: string; amountMinor: string; capturedAt: string }[];
    errors: { line: number; message: string }[];
  };
}
interface Closing {
  date: string; currencyCode: string; netMinor: string;
  sales: { byMethod: { method: string; orders: number; totalMinor: string }[]; orders: number; totalMinor: string; cancelledOrders: number; cancelledMinor: string };
  cardCaptured: { byMethod: { method: string; payments: number; totalMinor: string }[]; totalMinor: string };
  refunds: { byMethod: { method: string; refunds: number; totalMinor: string }[]; totalMinor: string };
  cash: { collectedMinor: string; collections: number; handedOverExpectedMinor: string; handedOverReceivedMinor: string; varianceMinor: string; stillWithDriversMinor: string; stillWithDriversCount: number };
}
interface Payment { id: string; provider: string; method: string; status: string; amountMinor: string; refundedMinor: string; currencyCode: string; providerRef: string | null; failureReason: string | null; createdAt: string; order: { orderNumber: string; status: string } }

export const EXCEPTION_LABEL: Record<Kind, { title: string; action: string }> = {
  CANCELLED_NOT_REFUNDED: { title: 'Cancelled, customer still charged', action: 'Create the refund' },
  DELIVERED_NOT_PAID: { title: 'Delivered, payment not taken', action: 'Check the payment with the gateway or driver' },
  AMOUNT_MISMATCH: { title: 'Amount differs from the order', action: 'Compare the payment with the order total' },
  CARD_PENDING: { title: 'Card payment stuck', action: 'Check the payment in the gateway dashboard' },
  COD_NO_COLLECTION: { title: 'Cash order without a collection', action: 'Find who took the cash' },
  CASH_NOT_HANDED_OVER: { title: 'Cash with a driver over a day', action: 'Receive it on the Cash page' },
};

/** Money checks: payments that do not line up, the gateway's settlement file, and the end-of-day closing report. */
export function PaymentsPage() {
  const [f, setF, ready] = useUrlState({ tab: 'problems' });
  const ex = useApi<Exceptions>('/admin/payments/exceptions');
  const total = ex.data ? Object.values(ex.data.counts).reduce((a, b) => a + b, 0) : null;
  return (
    <>
      <PageHeader title="Payments & closing" description="Find money that does not add up before it becomes a loss, match the gateway’s settlement file, and print the daily closing report." />
      <Card bodyClassName="p-0">
        <Tabs value={f.tab} onChange={(tab) => setF({ tab })} tabs={[
          { value: 'problems', label: 'Needs checking', count: total },
          { value: 'closing', label: 'Daily closing' },
          { value: 'settlement', label: 'Gateway settlement' },
          { value: 'all', label: 'All payments' },
        ]} />
        {!ready ? null : f.tab === 'problems' ? <Problems ex={ex} /> : f.tab === 'closing' ? <ClosingTab /> : f.tab === 'settlement' ? <SettlementTab /> : <AllPayments />}
      </Card>
    </>
  );
}

function Problems({ ex }: { ex: ApiState<Exceptions> }) {
  const [kind, setKind] = useState<Kind | ''>('');
  if (ex.error) return <ErrorState error={ex.error} onRetry={ex.reload} />;
  if (!ex.data) return <Table><tbody><SkeletonRows cols={5} /></tbody></Table>;
  const items = ex.data.items.filter((i) => !kind || i.kind === kind);
  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3" data-testid="exception-kinds">
        {(Object.keys(EXCEPTION_LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${kind === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}>
            {EXCEPTION_LABEL[k].title} <span className={ex.data!.counts[k] ? 'font-bold text-danger-600' : 'text-ink-400'}>{ex.data!.counts[k]}</span>
          </button>
        ))}
      </div>
      <Table>
        <thead><tr><th className="th">Problem</th><th className="th">Order</th><th className="th">Payment</th><th className="th text-end">Amount</th><th className="th">Since</th></tr></thead>
        <tbody>
          {items.map((e, i) => (
            <tr key={`${e.kind}-${e.orderNumber}-${i}`} className="align-top" data-testid="exception-row">
              <td className="td"><p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 text-amber-600" aria-hidden />{EXCEPTION_LABEL[e.kind].title}</p><p className="mt-0.5 max-w-md text-xs text-ink-500">{e.detail} — {EXCEPTION_LABEL[e.kind].action}.</p></td>
              <td className="td"><Link href={`/orders/${e.orderNumber}`} className="font-mono text-sm font-semibold hover:text-brand-700">{e.orderNumber}</Link><p><StatusBadge status={e.orderStatus} /></p></td>
              <td className="td text-sm">{e.method ? paymentMethodLabel(e.method) : '—'}{e.provider ? <span className="text-xs text-ink-500"> · {e.provider}</span> : null}</td>
              <td className="td text-end font-semibold tabular">{formatMoney(e.amountMinor, e.currencyCode)}</td>
              <td className="td text-ink-600" title={formatDateTime(e.since)}>{timeAgo(e.since)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!items.length ? <EmptyState icon={<CheckCircle2 className="size-6 text-success-600" aria-hidden />} title="Everything adds up" description="No payment problems found." /> : null}
    </>
  );
}

function ClosingTab() {
  const [date, setDate] = useState(todayInQatar());
  const c = useApi<Closing>(`/admin/payments/closing${qs({ date })}`);
  const { busy, run } = useAction();
  const d = c.data;
  const cur = d?.currencyCode ?? 'QAR';
  const variance = d ? BigInt(d.cash.varianceMinor) : 0n;
  return (
    <div className="p-5">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="label">Day</span><input type="date" className="input" value={date} max={todayInQatar()} onChange={(e) => setDate(e.target.value)} data-testid="closing-date" /></label>
        <button type="button" className="btn-secondary" disabled={busy === 'pdf'} onClick={() => run('pdf', () => openPdf(`/admin/payments/closing/pdf${qs({ date })}`, `FastMoveX-closing-${date}.pdf`))} data-testid="closing-pdf">
          {busy === 'pdf' ? <Spinner /> : <FileText className="size-4" aria-hidden />} Closing report (PDF)
        </button>
      </div>
      {c.error ? <ErrorState error={c.error} onRetry={c.reload} /> : !d ? <Spinner /> : (
        <div className="space-y-6" data-testid="closing">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Orders" value={d.sales.orders} sub={formatMoney(d.sales.totalMinor, cur)} />
            <Stat label="Card money in" value={formatMoney(d.cardCaptured.totalMinor, cur)} />
            <Stat label="Cash collected" value={formatMoney(d.cash.collectedMinor, cur)} sub={`${d.cash.collections} deliveries`} />
            <Stat label="Refunds out" value={formatMoney(d.refunds.totalMinor, cur)} />
            <Stat label="Net money in" value={formatMoney(d.netMinor, cur)} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Sales by payment method" bodyClassName="p-0">
              <Table>
                <thead><tr><th className="th">Method</th><th className="th text-end">Orders</th><th className="th text-end">Value</th></tr></thead>
                <tbody>
                  {d.sales.byMethod.map((m) => <tr key={m.method}><td className="td">{m.method === 'NONE' ? 'No payment' : paymentMethodLabel(m.method)}</td><td className="td text-end tabular">{m.orders}</td><td className="td text-end tabular">{formatMoney(m.totalMinor, cur)}</td></tr>)}
                  {d.sales.cancelledOrders ? <tr className="text-ink-500"><td className="td">Cancelled the same day</td><td className="td text-end tabular">{d.sales.cancelledOrders}</td><td className="td text-end tabular">{formatMoney(d.sales.cancelledMinor, cur)}</td></tr> : null}
                </tbody>
              </Table>
            </Card>
            <Card title="Cash">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-ink-600">Handed in — expected</dt><dd className="tabular">{formatMoney(d.cash.handedOverExpectedMinor, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-600">Handed in — counted</dt><dd className="tabular">{formatMoney(d.cash.handedOverReceivedMinor, cur)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Short / over</dt><dd className={`tabular ${variance < 0n ? 'text-danger-600' : ''}`}>{variance === 0n ? 'Exact' : formatMoney(d.cash.varianceMinor, cur)}</dd></div>
                <div className="flex justify-between border-t border-ink-100 pt-2"><dt className="text-ink-600">Still with drivers at day end</dt><dd className="tabular">{formatMoney(d.cash.stillWithDriversMinor, cur)} <span className="text-xs text-ink-500">({d.cash.stillWithDriversCount})</span></dd></div>
              </dl>
              <Link href="/cash" className="link mt-3 inline-block text-sm">Cash handovers →</Link>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SettlementTab() {
  const { can } = useSession();
  const list = useApi<Settlement[]>('/admin/payments/settlements');
  const [current, setCurrent] = useState<Settlement | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  async function upload(f: File) {
    const form = new FormData();
    form.append('file', f);
    form.append('provider', 'dibsy');
    const r = await run('up', () => api<Settlement>('/admin/payments/settlements', { method: 'POST', body: form }), (x) => `${x.matched} of ${x.rows} rows match`);
    if (file.current) file.current.value = '';
    if (r) { setCurrent(r); list.reload(); }
  }

  return (
    <div className="p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-600">Download the settlement report (CSV) from the Dibsy dashboard and upload it. Each row is matched to a FastMoveX payment by its reference; the file needs a <code>reference</code> and an <code>amount</code> column (a <code>date</code> column helps find payments missing from the file).</p>
        {can('payments.reconcile') ? (
          <label className="btn-primary cursor-pointer">
            {busy === 'up' ? <Spinner /> : <Upload className="size-4" aria-hidden />} Upload CSV
            <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid="settlement-file" />
          </label>
        ) : null}
      </div>
      {current ? <SettlementResult s={current} /> : null}
      <h3 className="mb-2 mt-6 text-sm font-semibold">Earlier uploads</h3>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <Table>
        <thead><tr><th className="th">File</th><th className="th text-end">Rows</th><th className="th text-end">Match</th><th className="th text-end">Differ</th><th className="th text-end">Not in FastMoveX</th><th className="th text-end">Not in file</th><th className="th" /></tr></thead>
        <tbody>
          {!list.data && !list.error ? <SkeletonRows cols={7} rows={2} /> : null}
          {list.data?.map((s) => (
            <tr key={s.id} data-testid="settlement-row">
              <td className="td"><p className="font-medium">{s.fileName}</p><p className="text-xs text-ink-500">{formatDateTime(s.createdAt)} · {formatMoney(s.fileTotalMinor, s.currencyCode)}</p></td>
              <td className="td text-end tabular">{s.rows}</td>
              <td className="td text-end tabular text-success-600">{s.matched}</td>
              <td className={`td text-end tabular ${s.mismatched ? 'text-danger-600' : ''}`}>{s.mismatched}</td>
              <td className={`td text-end tabular ${s.missing ? 'text-danger-600' : ''}`}>{s.missing}</td>
              <td className={`td text-end tabular ${s.extra ? 'text-amber-700' : ''}`}>{s.extra}</td>
              <td className="td text-end"><button type="button" className="btn-ghost btn-sm" onClick={() => api<Settlement>(`/admin/payments/settlements/${s.id}`).then(setCurrent).catch(() => undefined)}>Details</button></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function SettlementResult({ s }: { s: Settlement }) {
  const bad = s.result?.lines ?? [];
  return (
    <Card title={`${s.fileName} — ${s.matched} of ${s.rows} match`} className="mb-4" bodyClassName="p-0">
      <div data-testid="settlement-result">
        {bad.length || s.result?.extra.length || s.result?.errors.length ? (
          <Table>
            <thead><tr><th className="th">Row</th><th className="th">Reference</th><th className="th">Order</th><th className="th text-end">File</th><th className="th text-end">FastMoveX</th><th className="th">Result</th></tr></thead>
            <tbody>
              {bad.map((l) => (
                <tr key={`l${l.line}`}>
                  <td className="td tabular">{l.line}</td>
                  <td className="td font-mono text-xs">{l.reference}</td>
                  <td className="td">{l.orderNumber ? <Link href={`/orders/${l.orderNumber}`} className="link">{l.orderNumber}</Link> : '—'}</td>
                  <td className="td text-end tabular">{formatMoney(l.fileAmountMinor, s.currencyCode)}</td>
                  <td className="td text-end tabular">{l.joviaAmountMinor ? formatMoney(l.joviaAmountMinor, s.currencyCode) : '—'}</td>
                  <td className="td"><Badge tone={l.result === 'MISSING' ? 'red' : 'amber'}>{l.result === 'MISSING' ? 'Not in FastMoveX' : l.result === 'DUPLICATE' ? 'Duplicate' : 'Differs'}</Badge>{l.note ? <p className="text-xs text-ink-500">{l.note}</p> : null}</td>
                </tr>
              ))}
              {s.result?.extra.map((x) => (
                <tr key={`x${x.orderNumber}${x.reference}`}>
                  <td className="td">—</td><td className="td font-mono text-xs">{x.reference ?? '—'}</td>
                  <td className="td"><Link href={`/orders/${x.orderNumber}`} className="link">{x.orderNumber}</Link></td>
                  <td className="td text-end">—</td><td className="td text-end tabular">{formatMoney(x.amountMinor, s.currencyCode)}</td>
                  <td className="td"><Badge tone="amber">Not in the file</Badge><p className="text-xs text-ink-500">Paid {formatDateTime(x.capturedAt)} — ask the gateway</p></td>
                </tr>
              ))}
              {s.result?.errors.map((e) => (
                <tr key={`e${e.line}`}><td className="td tabular">{e.line}</td><td className="td text-danger-600" colSpan={5}>Could not read this row: {e.message}</td></tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState icon={<CheckCircle2 className="size-6 text-success-600" aria-hidden />} title="Every row matches" />}
      </div>
    </Card>
  );
}

function AllPayments() {
  const [f, setF] = useState({ status: '', method: '' });
  const list = useCursorList<Payment>(`/admin/payments${qs(f)}`);
  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-ink-100 p-3">
        <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
        </select>
        <select className="input w-auto" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} aria-label="Method">
          <option value="">Any method</option>
          {['CARD', 'APPLE_PAY', 'GOOGLE_PAY', 'COD'].map((m) => <option key={m} value={m}>{paymentMethodLabel(m)}</option>)}
        </select>
      </div>
      {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <Table>
        <thead><tr><th className="th">Order</th><th className="th">Method</th><th className="th">Status</th><th className="th">Reference</th><th className="th text-end">Amount</th><th className="th">When</th></tr></thead>
        <tbody>
          {!list.items ? <SkeletonRows cols={6} /> : null}
          {list.items?.map((p) => (
            <tr key={p.id}>
              <td className="td"><Link href={`/orders/${p.order.orderNumber}`} className="font-mono text-sm font-semibold hover:text-brand-700">{p.order.orderNumber}</Link></td>
              <td className="td text-sm">{paymentMethodLabel(p.method)} <span className="text-xs text-ink-500">· {p.provider}</span></td>
              <td className="td"><StatusBadge status={p.status} />{p.failureReason ? <p className="text-xs text-danger-600">{p.failureReason}</p> : null}</td>
              <td className="td font-mono text-xs">{p.providerRef ?? '—'}</td>
              <td className="td text-end tabular">{formatMoney(p.amountMinor, p.currencyCode)}{p.refundedMinor !== '0' ? <p className="text-xs text-ink-500">−{formatMoney(p.refundedMinor, p.currencyCode)} refunded</p> : null}</td>
              <td className="td text-ink-600">{formatDateTime(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </>
  );
}
