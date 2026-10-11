'use client';

import { Ban, Banknote, CheckCircle2, Download, Mail, Phone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Card, ConfirmDialog, EmptyState, ErrorState, KeyValue, Loading, PageHeader, Stat, StatusBadge, Table } from '@/components/ui';
import { api, download } from '@/lib/api/client';
import { isNotFound } from '@/lib/api/errors';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/state/session';
import { useAction, useApi } from '@/lib/use-api';
import { CustomerNotesCard, CustomerTagsCard } from '@/components/customers/CustomerNotes';
import { TagBadges } from '@/components/customers/tags';

interface Detail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  marketingOptIn: boolean;
  isGuest?: boolean;
  roles: string[];
  orders: { orderNumber: string; status: string; totalMinor: string; currencyCode: string; placedAt: string | null }[];
  tickets: { id: string; number: string; subject: string; status: string; createdAt: string }[];
  seller: { id: string; businessName: string; status: string } | null;
  phoneVerifiedAt?: string | null;
  codBlocked?: boolean;
  codBlockedReason?: string | null;
  codRefusals?: number;
  _count?: { orders: number; returns: number };
  deletionRequestedAt?: string | null;
  deletionScheduledFor?: string | null;
  deletedAt?: string | null;
  tags?: string[];
}

export function CustomerDetail({ id }: { id: string }) {
  const { can } = useSession();
  const c = useApi<Detail>(/^[0-9a-f-]{36}$/i.test(id) ? `/admin/users/${id}` : null);
  const [confirm, setConfirm] = useState(false);
  const [codConfirm, setCodConfirm] = useState(false);
  const { busy, run } = useAction();

  if (isNotFound(c.error) || !/^[0-9a-f-]{36}$/i.test(id)) return <EmptyState title="Customer not found" action={<Link href="/customers" className="btn-secondary">Back to customers</Link>} />;
  if (c.error) return <ErrorState error={c.error} onRetry={c.reload} />;
  if (!c.data) return <Loading />;
  const u = c.data;
  const counted = u.orders.filter((o) => !['CANCELLED', 'PENDING'].includes(o.status));
  const spent = counted.reduce((n, o) => n + BigInt(o.totalMinor), 0n);
  const cur = u.orders[0]?.currencyCode ?? 'QAR';
  const suspended = u.status === 'SUSPENDED';

  async function setStatus(reason: string) {
    const r = await run('status', () => api(`/admin/users/${u.id}/status`, { method: 'POST', body: { status: suspended ? 'ACTIVE' : 'SUSPENDED', reason } }), suspended ? 'Account reactivated' : 'Account suspended and signed out everywhere');
    if (r !== undefined) {
      setConfirm(false);
      c.reload();
    }
  }

  async function setCod(reason: string) {
    const blocked = !u.codBlocked;
    const r = await run('cod', () => api(`/admin/users/${u.id}/cod`, { method: 'POST', body: { blocked, reason: reason || undefined } }), blocked ? 'Cash on delivery switched off for this customer' : 'Cash on delivery switched back on');
    if (r !== undefined) { setCodConfirm(false); c.reload(); }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/customers', label: 'Customers' }}
        title={<span className="flex items-center gap-3">{u.fullName} <StatusBadge status={u.status} />{u.isGuest ? <span className="rounded bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">Guest</span> : null}<TagBadges tags={u.tags} /></span>}
        description={u.isGuest ? `Guest shopper since ${formatDate(u.createdAt)} — ordered without an account. They can claim it with “Forgot password” using this email.` : `Customer since ${formatDate(u.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {!u.deletedAt ? (
              <button type="button" className="btn-secondary" disabled={busy === 'export'} data-testid="data-export" title="For a customer's data request (PDPPL): the same file they can download themselves"
                onClick={() => run('export', () => download(`/admin/users/${u.id}/data-export`, `fastmovex-user-data-${u.id.slice(0, 8)}.json`))}>
                <Download className="size-4" aria-hidden /> Customer data
              </button>
            ) : null}
            {can('users.suspend') && !u.roles.some((r) => r.includes('ADMIN')) && !u.deletedAt ? (
              <button type="button" className={suspended ? 'btn-secondary' : 'btn-danger'} onClick={() => setConfirm(true)}>
                {suspended ? <CheckCircle2 className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />} {suspended ? 'Reactivate' : 'Suspend'}
              </button>
            ) : null}
          </div>
        }
      />
      {u.deletedAt ? (
        <p className="mb-4 rounded-xl border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700" data-testid="deleted-banner">Account deleted on {formatDate(u.deletedAt)} at the customer’s request. Orders and invoices are kept without personal details.</p>
      ) : u.deletionScheduledFor ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="deletion-banner">
          The customer asked to delete their account on {formatDate(u.deletionRequestedAt)}. It will be deleted on <strong>{formatDate(u.deletionScheduledFor)}</strong> unless they sign in and keep it.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Orders" value={formatNumber(u.orders.length)} />
        <Stat label="Total spent" value={formatMoney(spent.toString(), cur, { compact: true })} sub="Excluding cancelled and unpaid" />
        <Stat label="Average order" value={counted.length ? formatMoney((spent / BigInt(counted.length)).toString(), cur) : '—'} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card title="Orders" bodyClassName="p-0">
            {u.orders.length === 0 ? (
              <EmptyState title="No orders yet" />
            ) : (
              <Table>
                <thead><tr><th className="th">Order</th><th className="th">Date</th><th className="th">Status</th><th className="th text-end">Total</th></tr></thead>
                <tbody>
                  {u.orders.map((o) => (
                    <tr key={o.orderNumber} className="hover:bg-ink-25">
                      <td className="td">{can('orders.read') ? <Link href={`/orders/${o.orderNumber}`} className="font-medium hover:text-brand-700">{o.orderNumber}</Link> : o.orderNumber}</td>
                      <td className="td text-ink-600">{formatDateTime(o.placedAt)}</td>
                      <td className="td"><StatusBadge status={o.status} /></td>
                      <td className="td text-end tabular">{formatMoney(o.totalMinor, o.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {u.tickets.length ? (
            <Card title="Support tickets" bodyClassName="p-0">
              <ul className="divide-y divide-ink-100">
                {u.tickets.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    {can('tickets.read') ? <Link href={`/tickets/${t.id}`} className="font-medium hover:text-brand-700">{t.number}</Link> : <span className="font-medium">{t.number}</span>}
                    <span className="min-w-0 flex-1 truncate text-ink-600">{t.subject}</span>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
        {!u.deletedAt ? <CustomerTagsCard userId={u.id} tags={u.tags ?? []} onChange={(tags) => c.setData({ ...u, tags })} /> : null}
        {!u.deletedAt ? <CustomerNotesCard userId={u.id} /> : null}
        <Card title="Cash on delivery" actions={can('users.update') ? <button type="button" className={u.codBlocked ? 'btn-secondary btn-sm' : 'btn-ghost btn-sm text-danger-600'} onClick={() => setCodConfirm(true)} data-testid="cod-toggle">{u.codBlocked ? 'Allow COD' : 'Block COD'}</button> : undefined}>
          <div className="space-y-2 text-sm" data-testid="cod-status">
            <p className="flex items-center gap-2 font-medium">
              <Banknote className="size-4 text-ink-400" aria-hidden />
              {u.codBlocked ? <span className="text-danger-600">Blocked — card payments only</span> : <span className="text-success-700">Allowed</span>}
            </p>
            {u.codBlockedReason ? <p className="text-ink-600">{u.codBlockedReason}</p> : null}
            <KeyValue items={[
              ['Refused at the door', String(u.codRefusals ?? 0)],
              ['Returns', String(u._count?.returns ?? 0)],
              ['Mobile verified', u.phoneVerifiedAt ? formatDate(u.phoneVerifiedAt) : 'No'],
            ]} />
          </div>
        </Card>
        <Card title="Contact">
          <div className="space-y-2 text-sm">
            {u.email ? <a href={`mailto:${u.email}`} className="flex items-center gap-2 text-ink-700 hover:underline"><Mail className="size-4 text-ink-400" aria-hidden /> {u.email}</a> : null}
            {u.phone ? <a href={`tel:${u.phone}`} className="flex items-center gap-2 text-ink-700 hover:underline"><Phone className="size-4 text-ink-400" aria-hidden /> {u.phone}</a> : null}
          </div>
          <div className="mt-4 border-t border-ink-100 pt-4">
            <KeyValue items={[
              ['Last sign-in', u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'],
              ['Marketing', u.marketingOptIn ? 'Subscribed' : 'Not subscribed'],
              ['Roles', u.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')],
              ...(u.seller ? [['Seller', <span key="s">{u.seller.businessName} <StatusBadge status={u.seller.status} /></span>] as [string, React.ReactNode]] : []),
            ]} />
          </div>
        </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={setStatus}
        title={suspended ? 'Reactivate this account?' : 'Suspend this account?'}
        description={suspended ? 'The customer can sign in and order again.' : 'The customer is signed out on every device and cannot sign in or order. Past orders are not affected.'}
        reason={{ label: 'Reason (kept in the audit log)', required: true }}
        confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
        danger={!suspended}
        busy={busy === 'status'}
      />
      <ConfirmDialog
        open={codConfirm}
        onClose={() => setCodConfirm(false)}
        onConfirm={setCod}
        title={u.codBlocked ? 'Allow cash on delivery again?' : 'Block cash on delivery?'}
        description={u.codBlocked ? 'The refusal count starts again from zero.' : 'The customer (and anyone ordering with the same mobile number) can only pay by card.'}
        reason={u.codBlocked ? undefined : { label: 'Reason (kept in the audit log)', required: true, placeholder: 'e.g. Refused 3 orders at the door' }}
        confirmLabel={u.codBlocked ? 'Allow COD' : 'Block COD'}
        danger={!u.codBlocked}
        busy={busy === 'cod'}
      />
    </>
  );
}
