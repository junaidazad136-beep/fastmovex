'use client';

import { ArrowLeft, KeyRound, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Spinner } from '@/components/ui';
import { Logo } from '@/components/layout/Logo';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { cleanCode } from '@/lib/format';
import { useSession } from '@/lib/state/session';

function signInError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.reason === 'ACCOUNT_LOCKED') return err.message;
    if (err.reason === 'BAD_CODE') return 'That code is not right. Use the newest code in your authenticator app.';
    if (err.reason === 'CHALLENGE_EXPIRED') return 'That took too long. Enter your password again.';
    if (err.status === 401) return 'Incorrect email/phone or password.';
    return errorMessage(err);
  }
  return err instanceof Error ? err.message : errorMessage(err);
}

export function LoginForm({ next }: { next: string }) {
  const { status, signIn, signInWithCode } = useSession();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'signed-in') router.replace(next);
  }, [status, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await signIn(identifier.trim(), password);
      if (r.kind === 'code') {
        setChallenge(r.challenge);
        setCode('');
        setBusy(false);
      }
    } catch (err) {
      setError(signInError(err));
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      await signInWithCode(challenge, code);
    } catch (err) {
      if (err instanceof ApiError && (err.reason === 'CHALLENGE_EXPIRED' || (err.status === 401 && err.reason !== 'BAD_CODE'))) {
        setChallenge(null);
        setPassword('');
      }
      setError(signInError(err));
      setBusy(false);
    }
  }

  const back = () => { setChallenge(null); setPassword(''); setError(null); setRecovery(false); };
  const codeReady = recovery ? /^[A-Z2-7]{4}-?[A-Z2-7]{4}$/.test(code) : /^\d{6}$/.test(code);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo />
          <p className="text-sm text-ink-500">Admin panel</p>
        </div>
        {challenge ? (
          <form onSubmit={submitCode} className="card space-y-4 p-6" noValidate data-testid="two-step">
            <h1 className="text-lg font-semibold">Two-step sign-in</h1>
            <p className="text-sm text-ink-600">
              {recovery ? 'Enter one of the recovery codes you saved when you turned on two-step sign-in. Each code works once.' : 'Open your authenticator app and enter the 6-digit code for FastMoveX.'}
            </p>
            {error ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600" role="alert">{error}</p> : null}
            <div>
              <label className="label" htmlFor="code">{recovery ? 'Recovery code' : 'Code'}</label>
              <input
                id="code" className="input text-center text-lg tracking-[0.3em] tabular" dir="ltr" autoFocus
                inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" placeholder={recovery ? 'XXXX-XXXX' : '123456'}
                value={code} onChange={(e) => setCode(cleanCode(e.target.value, recovery))}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy || !codeReady}>
              {busy ? <Spinner /> : <KeyRound className="size-4" aria-hidden />} Verify
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="inline-flex items-center gap-1 text-ink-600 hover:text-ink-900" onClick={back}><ArrowLeft className="size-4" aria-hidden /> Back</button>
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => { setRecovery(!recovery); setCode(''); setError(null); }}>
                {recovery ? 'Use the app code' : 'Use a recovery code'}
              </button>
            </div>
            <p className="text-center text-xs text-ink-500">Lost your phone and your recovery codes? Ask another admin to reset your two-step sign-in.</p>
          </form>
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
            <h1 className="text-lg font-semibold">Sign in</h1>
            {error ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600" role="alert">{error}</p> : null}
            <div>
              <label className="label" htmlFor="identifier">Email or phone</label>
              <input id="identifier" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy || status === 'loading' || !identifier || !password}>
              {busy ? <Spinner /> : <Lock className="size-4" aria-hidden />} Sign in
            </button>
            <p className="text-center text-xs text-ink-500">Staff accounts only. Every action is recorded in the audit log.</p>
          </form>
        )}
      </div>
    </main>
  );
}
