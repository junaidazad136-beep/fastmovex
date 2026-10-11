'use client';

import { History, Plus, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, LoadMore, PageHeader, SkeletonRows, Spinner, StatusBadge, Table, TextField } from '@/components/ui';
import { api } from '@/lib/api/client';
import { decimalToMinor, formatDateTime, formatMoney, minorToInput, timeAgo } from '@/lib/format';
import { LoginHistoryTable } from '../security/SecurityPage';
import { useSession } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi, useCursorList } from '@/lib/use-api';

interface Staff { id: string; fullName: string; email: string | null; phone: string | null; status: string; lastLoginAt: string | null; roles: string[]; twoFactor?: boolean; lockedUntil?: string | null; refundLimitMinor?: string | null }

export const STAFF_ROLES: { code: string; name: string; description: string }[] = [
  { code: 'SUPER_ADMIN', name: 'Super admin', description: 'Everything, including staff, roles and seller payouts' },
  { code: 'ADMIN', name: 'Admin', description: 'Runs the store; cannot manage staff or roles' },
  { code: 'CATALOG_MANAGER', name: 'Catalogue & content', description: 'Products, stock, categories, banners, coupons, sales' },
  { code: 'INVENTORY_MANAGER', name: 'Inventory', description: 'Sees products, changes stock' },
  { code: 'ORDER_MANAGER', name: 'Orders', description: 'Orders, shipping, returns, customers (read)' },
  { code: 'OPERATIONS_ADMIN', name: 'Operations', description: 'Orders, delivery, catalogue, sellers' },
  { code: 'FINANCE_ADMIN', name: 'Finance', description: 'Payments, refunds, payouts, reports' },
  { code: 'SUPPORT_ADMIN', name: 'Customer support', description: 'Tickets, reviews, returns' },
  { code: 'DELIVERY_AGENT', name: 'Delivery driver', description: 'Driver app only, no admin panel' },
];
const roleName = (c: string) => STAFF_ROLES.find((r) => r.code === c)?.name ?? c;

function RolePicker({ value, onChange, canSuper }: { value: string[]; onChange: (v: string[]) => void; canSuper: boolean }) {
  return (
    <fieldset>
      <legend className="label">Roles</legend>
      <div className="space-y-2">
        {STAFF_ROLES.filter((r) => canSuper || r.code !== 'SUPER_ADMIN').map((r) => (
          <label key={r.code} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-100 p-2.5 hover:bg-ink-25">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={value.includes(r.code)} onChange={(e) => onChange(e.target.checked ? [...value, r.code] : value.filter((x) => x !== r.code))} />
            <span><span className="block text-sm font-medium">{r.name}</span><span className="block text-xs text-ink-500">{r.description}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StaffPage() {
  const toast = useToast();
  const { user } = useSession();
  const list = useCursorList<Staff>('/admin/staff');
  const { busy, run } = useAction();
  const [create, setCreate] = useState<{ fullName: string; email: string; phone: string; password: string; roles: string[] } | null>(null);
  const [edit, setEdit] = useState<{ s: Staff; roles: string[] } | null>(null);
  const [reset, setReset] = useState<Staff | null>(null);
  const [history, setHistory] = useState<Staff | null>(null);
  const [limit, setLimit] = useState<{ s: Staff; value: string } | null>(null);
  async function saveLimit() {
    if (!limit) return;
    const minor = limit.value.trim() ? decimalToMinor(limit.value) : null;
    if (limit.value.trim() && !minor) return;
    const r = await run('limit', () => api(`/admin/staff/${limit.s.id}/refund-limit`, { method: 'PUT', body: { limitMinor: minor } }), minor ? 'Refund limit saved' : 'No refund limit for this person');
    if (r !== undefined) { setLimit(null); list.reload(); }
  }
  const isSuper = !!user?.roles.includes('SUPER_ADMIN');

  async function submitCreate() {
    if (!create) return;
    if (create.password.length < 12 || !/[a-z]/.test(create.password) || !/[A-Z]/.test(create.password) || !/\d/.test(create.password)) return toast.error('Password: at least 12 characters with upper case, lower case and a number');
    if (!create.roles.length) return toast.error('Choose at least one role');
    const r = await run('create', () => api('/admin/staff', { method: 'POST', body: { fullName: create.fullName.trim(), email: create.email.trim().toLowerCase(), phone: create.phone.trim() || undefined, password: create.password, roles: create.roles } }), 'Staff account created. Share the password with them privately; they should change it after signing in.');
    if (r !== undefined) { setCreate(null); list.reload(); }
  }

  async function submitRoles() {
    if (!edit) return;
    const r = await run('roles', () => api(`/admin/staff/${edit.s.id}/roles`, { method: 'PUT', body: { roles: edit.roles } }), 'Roles updated. They apply within 15 minutes, or at the next sign-in.');
    if (r !== undefined) { setEdit(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Staff" description="People who can sign in to this panel, and what each can do." actions={<button type="button" className="btn-primary" onClick={() => setCreate({ fullName: '', email: '', phone: '', password: '', roles: [] })}><Plus className="size-4" aria-hidden /> Add staff</button>} />
      <Card bodyClassName="p-0">
        {list.error && !list.items ? <ErrorState error={list.error} onRetry={list.reload} /> : (
          <Table>
            <thead><tr><th className="th">Name</th><th className="th">Roles</th><th className="th">Status</th><th className="th">Two-step</th><th className="th">Refund limit</th><th className="th">Last sign-in</th><th className="th text-end">Actions</th></tr></thead>
            <tbody>
              {!list.items ? <SkeletonRows cols={7} /> : null}
              {list.items?.map((s) => (
                <tr key={s.id} className="hover:bg-ink-25">
                  <td className="td"><p className="font-medium">{s.fullName}{s.id === user?.id ? <span className="text-xs font-normal text-ink-500"> (you)</span> : null}</p><p className="text-xs text-ink-500">{s.email}</p></td>
                  <td className="td text-ink-700">{s.roles.filter((r) => r !== 'CUSTOMER').map(roleName).join(', ')}</td>
                  <td className="td"><StatusBadge status={s.status} />{s.lockedUntil ? <> <Badge tone="red">Locked until {formatDateTime(s.lockedUntil)}</Badge></> : null}</td>
                  <td className="td" data-testid="staff-2fa">{s.roles.every((r) => r === 'DELIVERY_AGENT' || r === 'CUSTOMER') ? <span className="text-xs text-ink-400">—</span> : s.twoFactor ? <Badge tone="green">On</Badge> : <Badge tone="amber">Off</Badge>}</td>
                  <td className="td text-sm" data-testid="staff-refund-limit">
                    {s.roles.some((r) => r === 'SUPER_ADMIN' || r === 'ADMIN' || r === 'FINANCE_ADMIN') ? (
                      <button type="button" className="link" disabled={s.id === user?.id} onClick={() => { setLimit({ s, value: s.refundLimitMinor ? minorToInput(s.refundLimitMinor) : '' }); }} title={s.id === user?.id ? 'Someone else sets your limit' : 'Biggest single refund this person may approve'}>
                        {s.refundLimitMinor ? formatMoney(s.refundLimitMinor) : 'No limit'}
                      </button>
                    ) : <span className="text-xs text-ink-400">—</span>}
                  </td>
                  <td className="td text-ink-600">{s.lastLoginAt ? timeAgo(s.lastLoginAt) : 'Never'}</td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setHistory(s)} aria-label={`Sign-ins of ${s.fullName}`}><History className="size-4" aria-hidden /> Sign-ins</button>
                      {s.twoFactor && s.id !== user?.id && (isSuper || !s.roles.includes('SUPER_ADMIN'))
                        ? <button type="button" className="btn-ghost btn-sm" onClick={() => setReset(s)}><ShieldOff className="size-4" aria-hidden /> Reset two-step</button> : null}
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setEdit({ s, roles: s.roles.filter((r) => STAFF_ROLES.some((x) => x.code === r)) })}>Change roles</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.items?.length === 0 ? <EmptyState title="No staff yet" /> : null}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </Card>

      <Dialog open={!!limit} onClose={() => setLimit(null)} title="Refund approval limit" description={limit ? `The biggest single refund ${limit.s.fullName} may approve. Bigger refunds wait for someone with a higher limit. Empty = no limit.` : undefined} size="sm"
        footer={<><button type="button" className="btn-secondary" onClick={() => setLimit(null)}>Cancel</button><button type="button" className="btn-primary" onClick={saveLimit} disabled={busy === 'limit'} data-testid="save-refund-limit">{busy === 'limit' ? <Spinner /> : null} Save</button></>}>
        {limit ? <TextField label="Limit (QAR)" inputMode="decimal" value={limit.value} onChange={(e) => setLimit({ ...limit, value: e.target.value })} placeholder="No limit" data-testid="refund-limit-input" /> : null}
      </Dialog>

      <Dialog open={!!create} onClose={() => setCreate(null)} title="Add staff" size="lg" footer={<><button type="button" className="btn-secondary" onClick={() => setCreate(null)}>Cancel</button><button type="button" className="btn-primary" onClick={submitCreate} disabled={busy === 'create' || !create?.fullName.trim() || !create?.email.includes('@')}>{busy === 'create' ? <Spinner /> : null} Create account</button></>}>
        {create ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Full name" required value={create.fullName} onChange={(e) => setCreate({ ...create, fullName: e.target.value })} autoFocus maxLength={100} />
              <TextField label="Work email" required type="email" value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} />
              <TextField label="Phone" value={create.phone} onChange={(e) => setCreate({ ...create, phone: e.target.value })} placeholder="+974…" />
              <TextField label="First password" required type="text" autoComplete="new-password" value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} hint="12+ characters, upper and lower case and a number" />
            </div>
            <RolePicker value={create.roles} onChange={(roles) => setCreate({ ...create, roles })} canSuper={isSuper} />
          </div>
        ) : null}
      </Dialog>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={`Roles of ${edit?.s.fullName ?? ''}`} description="Remove all roles to take away admin access (the account itself stays)." size="lg" footer={<><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" onClick={submitRoles} disabled={busy === 'roles'}>{busy === 'roles' ? <Spinner /> : null} Save roles</button></>}>
        {edit ? <RolePicker value={edit.roles} onChange={(roles) => setEdit({ ...edit, roles })} canSuper={isSuper} /> : null}
      </Dialog>

      <ConfirmDialog
        open={!!reset} onClose={() => setReset(null)} danger busy={busy === 'reset'} confirmLabel="Reset two-step sign-in"
        title={`Reset two-step sign-in for ${reset?.fullName ?? ''}?`}
        description="Use this only when they lost their phone and their recovery codes — check it is really them (call them). They are signed out everywhere and must set up two-step sign-in again at their next sign-in. This is recorded in the audit log."
        onConfirm={async () => {
          if (!reset) return;
          const r = await run('reset', () => api(`/admin/staff/${reset.id}/2fa/reset`, { method: 'POST' }), 'Two-step sign-in reset. They set it up again at their next sign-in.');
          if (r !== undefined) { setReset(null); list.reload(); }
        }}
      />
      {history ? <HistoryDialog staff={history} onClose={() => setHistory(null)} /> : null}
    </>
  );
}

function HistoryDialog({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const h = useApi<Parameters<typeof LoginHistoryTable>[0]['rows']>(`/admin/users/${staff.id}/login-history`);
  return (
    <Dialog open onClose={onClose} title={`Sign-ins of ${staff.fullName}`} description="The last 50 attempts, including wrong passwords and codes." size="xl">
      {h.error ? <ErrorState error={h.error} onRetry={h.reload} /> : <LoginHistoryTable rows={h.data} />}
    </Dialog>
  );
}
