'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, ErrorState, Loading, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api/client';
import { humanize } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { STAFF_ROLES } from '../staff/StaffPage';

interface Role { code: string; name: string; isSystem: boolean; permissions: string[] }
interface Permission { code: string; group: string }

const ORDER = ['SUPER_ADMIN', 'ADMIN', 'CATALOG_MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'];

/** What each role may do. Changes apply to everyone with the role within 15 minutes (next token refresh). */
export function RolesPage() {
  const roles = useApi<Role[]>('/admin/roles');
  const perms = useApi<Permission[]>('/admin/permissions');
  const [code, setCode] = useState('ADMIN');
  const [draft, setDraft] = useState<string[]>([]);
  const { busy, run } = useAction();

  const staffRoles = useMemo(() => (roles.data ?? []).filter((r) => ORDER.includes(r.code)).sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code)), [roles.data]);
  const role = staffRoles.find((r) => r.code === code);
  useEffect(() => { if (role) setDraft(role.permissions); }, [role]);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of perms.data ?? []) m.set(p.group, [...(m.get(p.group) ?? []), p.code]);
    return [...m.entries()];
  }, [perms.data]);

  if (roles.error || perms.error) return <ErrorState error={roles.error ?? perms.error} onRetry={() => { roles.reload(); perms.reload(); }} />;
  if (!roles.data || !perms.data) return <Loading />;
  const locked = code === 'SUPER_ADMIN';
  const dirty = role && [...draft].sort().join() !== [...role.permissions].sort().join();

  async function save() {
    const r = await run('save', () => api(`/admin/roles/${code}/permissions`, { method: 'PUT', body: { permissions: draft } }), 'Permissions saved');
    if (r !== undefined) roles.reload();
  }

  return (
    <>
      <PageHeader title="Roles & permissions" description="Give each role only what it needs. Changes reach signed-in staff within 15 minutes." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card bodyClassName="p-2">
          <ul>
            {staffRoles.map((r) => (
              <li key={r.code}>
                <button type="button" onClick={() => setCode(r.code)} aria-current={code === r.code ? 'true' : undefined} className={clsx('w-full rounded-lg px-3 py-2 text-start text-sm', code === r.code ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-ink-50')}>
                  {STAFF_ROLES.find((x) => x.code === r.code)?.name ?? r.name}
                  <span className="block text-xs font-normal text-ink-500">{r.permissions.length} permissions</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title={role ? STAFF_ROLES.find((x) => x.code === role.code)?.name ?? role.name : ''}
          description={STAFF_ROLES.find((x) => x.code === code)?.description}
          actions={locked ? <Badge>Always has everything</Badge> : <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!dirty || busy === 'save'}>{busy === 'save' ? <Spinner /> : null} Save</button>}
        >
          <div className="grid gap-6 md:grid-cols-2">
            {groups.map(([g, codes]) => (
              <fieldset key={g} disabled={locked}>
                <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">{humanize(g)}</legend>
                <div className="space-y-1.5">
                  {codes.map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-brand-600" checked={locked || draft.includes(p)} onChange={(e) => setDraft(e.target.checked ? [...draft, p] : draft.filter((x) => x !== p))} />
                      <span>{humanize(p)}</span>
                      <code className="text-[11px] text-ink-400">{p}</code>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
