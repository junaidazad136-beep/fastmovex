'use client';

import clsx from 'clsx';
import { CheckCircle2, ScanLine, Save, Send, XCircle } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { summaryStale } from '@/components/layout/Shell';
import { VariantPicker } from '@/components/products/VariantPicker';
import { Badge, Card, ConfirmDialog, Dialog, ErrorState, KeyValue, Loading, PageHeader, Spinner, Stat, Table } from '@/components/ui';
import { api } from '@/lib/api/client';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';
import { COUNT_STATUS } from '../StockCountsPage';

interface Line {
  variantId: string; sku: string; barcode: string | null; title: string; countedQty: number | null; countedAt: string | null;
  expectedQty?: number; difference?: number | null; differenceValueMinor?: string | null;
}
interface Count {
  id: string; number: string; status: string; blind: boolean; note: string | null; createdAt: string; createdById: string;
  submittedById: string | null; submittedAt: string | null; approvedById: string | null; approvedAt: string | null;
  warehouse: { id: string; name: string; code: string };
  lines: Line[]; progress: { counted: number; total: number };
  shortValueMinor?: string; overValueMinor?: string; currencyCode?: string;
}

/**
 * Counting screen. Scan a barcode (or type a SKU) to jump to the product, type how many are on the shelf, save as you
 * go. Submitting locks the count; another person with approval rights checks the differences and posts them.
 */
export function StockCountDetail({ id }: { id: string }) {
  const { can, user } = useSession();
  const toast = useToast();
  const c = useApi<Count>(`/admin/stock-counts/${id}`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [scan, setScan] = useState('');
  const [onlyLeft, setOnlyLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<'submit' | 'approve' | 'cancel' | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const { busy, run } = useAction();
  const d = c.data;
  const open = d?.status === 'OPEN';
  const reveal = !!d && d.lines.some((l) => l.expectedQty !== undefined);

  const changed = useMemo(() => Object.entries(draft).filter(([vid, v]) => {
    const line = d?.lines.find((l) => l.variantId === vid);
    return v !== '' && line && String(line.countedQty ?? '') !== v;
  }), [draft, d]);

  if (c.error) return <ErrorState error={c.error} onRetry={c.reload} />;
  if (!d) return <Loading />;

  const rows = d.lines.filter((l) => !onlyLeft || (l.countedQty === null && !draft[l.variantId]));

  function onScan(e: FormEvent) {
    e.preventDefault();
    const q = scan.trim().toLowerCase();
    if (!q || !d) return;
    const hit = d.lines.find((l) => l.barcode?.toLowerCase() === q || l.sku.toLowerCase() === q);
    if (!hit) { toast.error(`“${scan.trim()}” is not on this count — use “Add a product”`); return; }
    setScan('');
    setOnlyLeft(false);
    // a scan of an item already being typed adds one (scanning each unit is common)
    setDraft((prev) => ({ ...prev, [hit.variantId]: String((Number.parseInt(prev[hit.variantId] ?? '', 10) || hit.countedQty || 0) + 1) }));
    requestAnimationFrame(() => { const el = inputs.current[hit.variantId]; el?.focus(); el?.select(); el?.scrollIntoView({ block: 'center' }); });
  }

  async function save(extra: { variantId: string; countedQty: number }[] = []) {
    const lines = [...changed.map(([variantId, v]) => ({ variantId, countedQty: Number.parseInt(v, 10) })), ...extra];
    if (!lines.length) return true;
    const r = await run('save', () => api<Count>(`/admin/stock-counts/${id}/lines`, { method: 'PATCH', body: { lines } }), `${lines.length} count${lines.length === 1 ? '' : 's'} saved`);
    if (r) { c.setData(r); setDraft({}); return true; }
    return false;
  }

  async function act(kind: 'submit' | 'approve' | 'cancel') {
    if (kind === 'submit' && !(await save())) return;
    const r = await run(kind, () => api<{ unitsAdded?: number; unitsRemoved?: number }>(`/admin/stock-counts/${id}/${kind}`, { method: 'POST' }),
      (x) => kind === 'approve' ? `Approved: ${x.unitsRemoved ?? 0} units removed, ${x.unitsAdded ?? 0} added` : kind === 'submit' ? 'Submitted for approval' : 'Stocktake cancelled');
    setConfirm(null);
    if (r) { c.reload(); summaryStale(); }
  }

  const selfSubmitted = d.submittedById === user?.id;
  const left = d.progress.total - d.progress.counted;

  return (
    <>
      <PageHeader
        back={{ href: '/stock-counts', label: 'Stocktake' }}
        title={<span className="font-mono">{d.number}</span>}
        description={<>{d.warehouse.name} · started {formatDateTime(d.createdAt)}{d.note ? ` · ${d.note}` : ''}</>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={COUNT_STATUS[d.status]?.tone ?? 'gray'}>{COUNT_STATUS[d.status]?.label ?? d.status}</Badge>
            {open && can('inventory.manage') ? (
              <>
                <button type="button" className="btn-secondary" disabled={!changed.length || !!busy} onClick={() => save()} data-testid="save-counts">{busy === 'save' ? <Spinner /> : <Save className="size-4" aria-hidden />} Save {changed.length ? `(${changed.length})` : ''}</button>
                <button type="button" className="btn-primary" disabled={!!busy || left - changed.filter(([vid]) => d.lines.find((l) => l.variantId === vid)?.countedQty === null).length > 0} onClick={() => setConfirm('submit')} data-testid="submit-count"><Send className="size-4" aria-hidden /> Submit</button>
              </>
            ) : null}
            {d.status === 'SUBMITTED' && can('inventory.approve') ? (
              selfSubmitted ? <span className="self-center text-sm text-ink-500" data-testid="own-count">You submitted it — another person approves</span>
                : <button type="button" className="btn-primary" disabled={!!busy} onClick={() => setConfirm('approve')} data-testid="approve-count"><CheckCircle2 className="size-4" aria-hidden /> Approve differences</button>
            ) : null}
            {(open || d.status === 'SUBMITTED') && can('inventory.manage') ? <button type="button" className="btn-ghost" onClick={() => setConfirm('cancel')}><XCircle className="size-4" aria-hidden /> Cancel</button> : null}
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Counted" value={`${d.progress.counted} / ${d.progress.total}`} tone={left && d.status !== 'OPEN' ? 'warn' : undefined} />
        {reveal ? (
          <>
            <Stat label="Short (at cost)" value={formatMoney(d.shortValueMinor ?? '0', d.currencyCode)} tone={d.shortValueMinor && d.shortValueMinor !== '0' ? 'danger' : undefined} />
            <Stat label="Over (at cost)" value={formatMoney(d.overValueMinor ?? '0', d.currencyCode)} />
          </>
        ) : <Stat label="Blind count" value="Expected numbers hidden" sub="Shown to the approver after you submit" />}
        {d.approvedAt ? <Stat label="Approved" value={formatDateTime(d.approvedAt)} /> : d.submittedAt ? <Stat label="Submitted" value={formatDateTime(d.submittedAt)} /> : null}
      </div>

      <Card bodyClassName="p-0">
        {open && can('inventory.manage') ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
            <form onSubmit={onScan} className="flex min-w-[240px] flex-1 items-center gap-2">
              <ScanLine className="size-5 text-ink-400" aria-hidden />
              <input className="input" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan a barcode or type a SKU, then Enter" aria-label="Scan barcode or SKU" data-testid="scan" autoFocus />
            </form>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} /> Only not counted ({left})</label>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}>Add a product</button>
          </div>
        ) : null}
        <Table>
          <thead>
            <tr>
              <th className="th">Product</th>
              {reveal ? <th className="th text-end">Expected</th> : null}
              <th className="th text-end">Counted</th>
              {reveal ? <><th className="th text-end">Difference</th><th className="th text-end">Value</th></> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const v = draft[l.variantId] ?? (l.countedQty === null ? '' : String(l.countedQty));
              return (
                <tr key={l.variantId} className={clsx(draft[l.variantId] !== undefined && 'bg-brand-50/40')} data-testid="count-line">
                  <td className="td"><p className="font-medium">{l.title}</p><p className="text-xs text-ink-500">{l.sku}{l.barcode ? ` · ${l.barcode}` : ''}</p></td>
                  {reveal ? <td className="td text-end tabular text-ink-600">{l.expectedQty}</td> : null}
                  <td className="td text-end">
                    {open && can('inventory.manage') ? (
                      <input
                        ref={(el) => { inputs.current[l.variantId] = el; }}
                        className="input ms-auto w-24 text-end tabular" inputMode="numeric" value={v} placeholder="—"
                        aria-label={`Counted ${l.sku}`}
                        onChange={(e) => setDraft({ ...draft, [l.variantId]: e.target.value.replace(/\D/g, '').slice(0, 7) })}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
                      />
                    ) : <span className="tabular">{l.countedQty ?? '—'}</span>}
                  </td>
                  {reveal ? (
                    <>
                      <td className={clsx('td text-end font-semibold tabular', (l.difference ?? 0) < 0 ? 'text-danger-600' : (l.difference ?? 0) > 0 ? 'text-success-600' : 'text-ink-400')}>
                        {l.difference === null || l.difference === undefined ? '—' : `${l.difference > 0 ? '+' : ''}${l.difference}`}
                      </td>
                      <td className="td text-end tabular">{l.differenceValueMinor && l.differenceValueMinor !== '0' ? formatMoney(l.differenceValueMinor, d.currencyCode) : '—'}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {d.status === 'SUBMITTED' ? (
        <Card className="mt-6" title="Before you approve">
          <KeyValue items={[
            ['What happens', 'Each difference becomes a “Stocktake” stock movement with your name. Missing units are written off; extra units are added.'],
            ['Check first', 'Large shortages: recount that shelf. Units in open orders cannot be counted away — sort those orders out first.'],
          ]} />
        </Card>
      ) : null}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a product to this count" description="Found something that is not on the list (wrong shelf, new product)? Pick it, then type how many.">
        <VariantPicker exclude={d.lines.map((l) => l.variantId)} onPick={async (v) => {
          setAdding(false);
          const qty = window.prompt(`How many ${v.sku} did you count?`, '1');
          const n = Number.parseInt(qty ?? '', 10);
          if (Number.isInteger(n) && n >= 0) await save([{ variantId: v.variantId, countedQty: n }]);
        }} />
      </Dialog>

      <ConfirmDialog
        open={confirm !== null} onClose={() => setConfirm(null)} busy={!!busy} danger={confirm === 'cancel'}
        onConfirm={() => confirm && act(confirm)}
        confirmLabel={confirm === 'approve' ? 'Approve and post' : confirm === 'submit' ? 'Submit' : 'Cancel stocktake'}
        title={confirm === 'approve' ? 'Approve this stocktake?' : confirm === 'submit' ? 'Submit the count?' : 'Cancel this stocktake?'}
        description={confirm === 'approve'
          ? `Stock will change to what was counted: ${formatMoney(d.shortValueMinor ?? '0', d.currencyCode)} short, ${formatMoney(d.overValueMinor ?? '0', d.currencyCode)} over (at cost). This cannot be undone.`
          : confirm === 'submit' ? 'You cannot change the numbers after submitting. Another person with approval rights checks and approves.' : 'Nothing changes in stock. You can start a new one.'}
      />
    </>
  );
}
