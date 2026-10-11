'use client';

import { CheckCircle2, Copy, Download, KeyRound, LogOut, MonitorSmartphone, ShieldAlert, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Card, Dialog, ErrorState, PageHeader, SkeletonRows, Spinner, Table, TextField } from '@/components/ui';
import { api, setSession } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useSession, type TwoFactorStatus } from '@/lib/state/session';
import { useToast } from '@/lib/state/toast';
import { useAction, useApi } from '@/lib/use-api';

interface SessionRow { id: string; device: string; ip: string | null; lastActiveAt: string; signedInAt: string; twoStep: boolean; current: boolean }
interface LoginRow { id: string; success: boolean; reason: string; method: string; client: string; ip: string | null; device: string; newDevice: boolean; createdAt: string }

const REASONS: Record<string, string> = {
  OK: 'Signed in', BAD_PASSWORD: 'Wrong password', BAD_CODE: 'Wrong code', LOCKED: 'Blocked — account paused', INACTIVE: 'Account not active', NOT_STAFF: 'Not a staff account',
};

/** The signed-in staff member's own account security: two-step sign-in, signed-in devices and recent sign-ins. */
export function SecurityPage() {
  const { mustSetUpTwoFactor, refreshUser } = useSession();
  const status = useApi<TwoFactorStatus>('/auth/2fa');
  const sessions = useApi<SessionRow[]>('/auth/sessions');
  const history = useApi<LoginRow[]>('/auth/login-history');
  const { busy, run } = useAction();
  const [setup, setSetup] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [regen, setRegen] = useState(false);
  const [disable, setDisable] = useState(false);
  const s = status.data;

  const reloadAll = () => { status.reload(); sessions.reload(); history.reload(); };

  return (
    <>
      <PageHeader title="My security" description="Protect your staff account: two-step sign-in, where you are signed in, and recent sign-ins." />
      {mustSetUpTwoFactor ? (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert" data-testid="2fa-required">
          <ShieldAlert className="size-5 shrink-0" aria-hidden />
          <p><strong>Two-step sign-in is required for staff.</strong> Turn it on below to use the admin panel. You will need an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
        </div>
      ) : null}

      <Card title="Two-step sign-in" description="After your password, a 6-digit code from your phone is needed — a stolen password alone is not enough." className="mb-6">
        {status.error ? <ErrorState error={status.error} onRetry={status.reload} /> : !s ? <Spinner /> : (
          <div className="flex flex-wrap items-center justify-between gap-4" data-testid="2fa-status">
            <div className="flex items-start gap-3">
              {s.enabled ? <ShieldCheck className="size-6 text-success-600" aria-hidden /> : <ShieldAlert className="size-6 text-amber-600" aria-hidden />}
              <div>
                <p className="font-semibold">{s.enabled ? 'On' : 'Off'} {s.required ? <Badge tone="blue">Required for staff</Badge> : null}</p>
                <p className="text-sm text-ink-600">
                  {s.enabled ? `Turned on ${formatDateTime(s.enabledAt)} · ${s.recoveryCodesLeft} recovery code${s.recoveryCodesLeft === 1 ? '' : 's'} left` : 'Your account is protected by your password only.'}
                </p>
                {s.enabled && s.recoveryCodesLeft <= 3 ? <p className="mt-1 text-sm font-medium text-amber-700">Few recovery codes left — make new ones.</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {s.enabled ? (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setRegen(true)}><KeyRound className="size-4" aria-hidden /> New recovery codes</button>
                  {!s.required ? <button type="button" className="btn-ghost btn-sm text-danger-600" onClick={() => setDisable(true)}>Turn off</button> : null}
                </>
              ) : <button type="button" className="btn-primary" onClick={() => setSetup(true)}><ShieldCheck className="size-4" aria-hidden /> Turn on two-step sign-in</button>}
            </div>
          </div>
        )}
      </Card>

      <Card title="Where you are signed in" description="End any session you do not recognise. Ending one signs that device out within 15 minutes." className="mb-6" bodyClassName="p-0">
        {sessions.error ? <ErrorState error={sessions.error} onRetry={sessions.reload} /> : null}
        <Table>
          <thead><tr><th className="th">Device</th><th className="th">IP</th><th className="th">Signed in</th><th className="th">Last active</th><th className="th" /></tr></thead>
          <tbody>
            {!sessions.data && !sessions.error ? <SkeletonRows cols={5} rows={2} /> : null}
            {sessions.data?.map((r) => (
              <tr key={r.id} data-testid="session-row">
                <td className="td"><span className="inline-flex items-center gap-2 font-medium"><MonitorSmartphone className="size-4 text-ink-400" aria-hidden /> {r.device}</span> {r.current ? <Badge tone="green">This device</Badge> : null} {r.twoStep ? <Badge tone="blue">2-step</Badge> : null}</td>
                <td className="td text-ink-600" dir="ltr">{r.ip ?? '—'}</td>
                <td className="td text-ink-600">{formatDateTime(r.signedInAt)}</td>
                <td className="td text-ink-600" title={formatDateTime(r.lastActiveAt)}>{timeAgo(r.lastActiveAt)}</td>
                <td className="td text-end">
                  {!r.current ? (
                    <button type="button" className="btn-ghost btn-sm" disabled={busy === r.id}
                      onClick={() => run(r.id, () => api(`/auth/sessions/${r.id}`, { method: 'DELETE' }), 'Signed out of that device').then(() => sessions.reload())}>
                      <LogOut className="size-4" aria-hidden /> Sign out
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Recent sign-ins" description="Every attempt on your account, including wrong passwords. Tell an admin if you see one that was not you." bodyClassName="p-0">
        {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : null}
        <LoginHistoryTable rows={history.data} />
      </Card>

      {setup ? <SetupDialog onClose={() => setSetup(false)} onDone={async (c) => { setSetup(false); setCodes(c); await refreshUser(); reloadAll(); }} /> : null}
      {regen ? <RegenerateDialog onClose={() => setRegen(false)} onDone={(c) => { setRegen(false); setCodes(c); status.reload(); }} /> : null}
      {disable ? <DisableDialog onClose={() => setDisable(false)} onDone={() => { setDisable(false); window.location.assign('/login'); }} /> : null}
      {codes ? <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} /> : null}
    </>
  );
}

export function LoginHistoryTable({ rows }: { rows: LoginRow[] | undefined }) {
  return (
    <Table>
      <thead><tr><th className="th">When</th><th className="th">Result</th><th className="th">Device</th><th className="th">IP</th><th className="th">Where</th></tr></thead>
      <tbody>
        {!rows ? <SkeletonRows cols={5} rows={4} /> : null}
        {rows?.map((r) => (
          <tr key={r.id} data-testid="login-row">
            <td className="td text-ink-600">{formatDateTime(r.createdAt)}</td>
            <td className="td">
              {r.success ? <Badge tone="green">{REASONS.OK}</Badge> : <Badge tone="red">{REASONS[r.reason] ?? r.reason}</Badge>}
              {r.newDevice ? <> <Badge tone="amber">New device</Badge></> : null}
              {r.success && r.method === 'recovery' ? <> <Badge>Recovery code</Badge></> : null}
            </td>
            <td className="td">{r.device}</td>
            <td className="td text-ink-600" dir="ltr">{r.ip ?? '—'}</td>
            <td className="td text-ink-600">{r.client === 'admin' ? 'Admin panel' : r.client === 'mobile' ? 'App' : 'Website'}</td>
          </tr>
        ))}
      </tbody>
      {rows && !rows.length ? <tbody><tr><td className="td text-ink-500" colSpan={5}>No sign-ins yet</td></tr></tbody> : null}
    </Table>
  );
}

const sixDigits = (v: string) => v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '').slice(0, 6);

function SetupDialog({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup', { method: 'POST' })
      .then(async (d) => { setData(d); setQr(await QRCode.toDataURL(d.otpauthUrl, { margin: 1, width: 220 })); })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[]; accessToken: string; expiresIn: number }>('/auth/2fa/enable', { method: 'POST', body: { code } });
      setSession(r.accessToken, r.expiresIn); // this device gets a fresh two-step session; all others were signed out
      toast.success('Two-step sign-in is on');
      onDone(r.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Turn on two-step sign-in" description="Scan with your authenticator app, then enter the code it shows." size="md"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="setup-2fa" className="btn-primary" disabled={busy || code.length !== 6}>{busy ? <Spinner /> : null} Turn on</button></>}>
      <form id="setup-2fa" onSubmit={submit} className="space-y-4" data-testid="setup-2fa">
        {error ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600" role="alert">{error}</p> : null}
        <ol className="list-decimal space-y-1 ps-5 text-sm text-ink-700">
          <li>Open Google Authenticator, Microsoft Authenticator or 1Password on your phone.</li>
          <li>Add an account and scan this QR code.</li>
          <li>Type the 6-digit code it shows for FastMoveX.</li>
        </ol>
        <div className="flex flex-col items-center gap-2">
          {qr ? <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-lg border border-ink-100" /> : <div className="flex size-[220px] items-center justify-center"><Spinner /></div>}
          {data ? (
            <details className="w-full text-center text-sm">
              <summary className="cursor-pointer text-brand-700">Can’t scan? Enter this key instead</summary>
              <code className="mt-2 block break-all rounded-lg bg-ink-50 px-3 py-2 font-mono text-sm tracking-wider" dir="ltr" data-testid="2fa-secret">{data.secret}</code>
            </details>
          ) : null}
        </div>
        <TextField label="Code from the app" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="text-center tracking-[0.3em]" value={code} onChange={(e) => setCode(sixDigits(e.target.value))} placeholder="123456" />
        <p className="text-xs text-ink-500">Turning it on signs you out on every other device.</p>
      </form>
    </Dialog>
  );
}

function RegenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const [code, setCode] = useState('');
  const { busy, run } = useAction();
  return (
    <Dialog open onClose={onClose} title="New recovery codes" description="Your old recovery codes stop working." size="sm"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!!busy || code.length !== 6}
          onClick={() => run('regen', () => api<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { method: 'POST', body: { code } })).then((r) => r && onDone(r.recoveryCodes))}>Make new codes</button></>}>
      <TextField label="Current code from your authenticator app" inputMode="numeric" dir="ltr" value={code} onChange={(e) => setCode(sixDigits(e.target.value))} />
    </Dialog>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { busy, run } = useAction();
  return (
    <Dialog open onClose={onClose} title="Turn off two-step sign-in" description="Your account will be protected by your password only. You will be signed out everywhere." size="sm"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-danger" disabled={!!busy || !password || code.length < 6}
          onClick={() => run('off', () => api('/auth/2fa/disable', { method: 'POST', body: { password, code } }), 'Two-step sign-in is off').then((r) => r !== undefined && onDone())}>Turn off</button></>}>
      <div className="space-y-3">
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="Code from your app (or a recovery code)" dir="ltr" value={code} onChange={(e) => setCode(e.target.value.trim().slice(0, 9))} />
      </div>
    </Dialog>
  );
}

function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const text = `FastMoveX admin — recovery codes\nEach code works once. Keep them somewhere safe (not on the same phone).\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'fastmovex-recovery-codes.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setSaved(true);
  };
  return (
    <Dialog open onClose={() => saved && onClose()} title="Save your recovery codes" description="If you lose your phone, each of these codes lets you sign in once. They are shown only now." size="sm"
      footer={<button type="button" className="btn-primary" disabled={!saved} onClick={onClose} data-testid="codes-done"><CheckCircle2 className="size-4" aria-hidden /> I saved them</button>}>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm" dir="ltr" data-testid="recovery-codes">
        {codes.map((c) => <li key={c} className="rounded-lg bg-ink-50 px-3 py-2 text-center tracking-wider">{c}</li>)}
      </ul>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-secondary btn-sm flex-1" onClick={download}><Download className="size-4" aria-hidden /> Download</button>
        <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => { setSaved(true); toast.success('Copied'); }).catch(() => toast.error('Could not copy — download them instead'))}><Copy className="size-4" aria-hidden /> Copy</button>
      </div>
    </Dialog>
  );
}
