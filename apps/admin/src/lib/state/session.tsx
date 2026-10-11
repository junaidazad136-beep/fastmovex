'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as client from '../api/client';
import { cachedProfile, clearDriverData } from '../driver-offline';

export interface StaffUser {
  id: string;
  fullName: string;
  email: string | null;
  roles: string[];
  perms: string[];
  twoFactor: TwoFactorStatus | null;
  /** biggest single refund this person may approve (minor units); null = no limit */
  refundLimitMinor?: string | null;
}

export interface TwoFactorStatus { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean; thisSession: boolean }

type Status = 'loading' | 'signed-in' | 'signed-out';

interface SessionValue {
  status: Status;
  user: StaffUser | null;
  /** True when the staff member has every listed permission (same rule as the API's @RequirePermissions). */
  can: (...perms: string[]) => boolean;
  /** A FastMoveX driver (may also be staff). */
  isDriver: boolean;
  /** Only a driver: the panel shows them the driver page and nothing else. */
  driverOnly: boolean;
  /** Two-step sign-in is required for staff here and this session has not passed it: only the Security page works. */
  mustSetUpTwoFactor: boolean;
  /** 'code' when the account has two-step sign-in on: finish with signInWithCode. */
  signIn: (identifier: string, password: string) => Promise<client.LoginResult>;
  signInWithCode: (challenge: string, code: string) => Promise<void>;
  /** Reloads the account (after turning two-step sign-in on, which issues a new session). */
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function loadUser(): Promise<StaffUser | null> {
  const claims = client.decodeToken(client.currentToken());
  if (!claims || !claims.perms.length) return null; // staff, or a driver (who only gets the driver page)
  const me = await client.api<{ id: string; fullName: string; email: string | null; twoFactor?: TwoFactorStatus; refundLimitMinor?: string | null }>('/auth/me');
  return { id: me.id, fullName: me.fullName, email: me.email, roles: claims.roles, perms: claims.perms, twoFactor: me.twoFactor ?? null, refundLimitMinor: me.refundLimitMinor ?? null };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<StaffUser | null>(null);
  const [offline, setOffline] = useState(false);

  // opened without signal: confirm the session as soon as the phone is back online
  useEffect(() => {
    if (!offline) return;
    const retry = async () => {
      try {
        const ok = await client.refreshSession();
        const u = ok ? await loadUser() : null;
        setOffline(false);
        if (u) setUser(u); else { setUser(null); setStatus('signed-out'); }
      } catch { /* still offline */ }
    };
    window.addEventListener('online', retry);
    const id = window.setInterval(() => { if (navigator.onLine) void retry(); }, 30_000);
    return () => { window.removeEventListener('online', retry); window.clearInterval(id); };
  }, [offline]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = client.hasSessionHint() ? await client.refreshSession() : false;
        const u = ok ? await loadUser() : null;
        if (cancelled) return;
        setUser(u);
        setStatus(u ? 'signed-in' : 'signed-out');
      } catch (e) {
        if (cancelled) return;
        // no signal: a driver who was signed in on this phone keeps their day on screen (actions wait in the outbox)
        const cached = (e as Error)?.name === 'NetworkError' ? cachedProfile() : null;
        if (cached) {
          setUser({ ...cached, twoFactor: null, refundLimitMinor: null });
          setStatus('signed-in');
          setOffline(true);
        } else setStatus('signed-out');
      }
    })();
    const off = client.onAuthChange((signedIn) => {
      if (!signedIn) {
        setUser(null);
        setStatus('signed-out');
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Permissions are reloaded with every token refresh; keep the menu in step with them.
  useEffect(() => {
    if (status !== 'signed-in') return;
    const id = setInterval(() => {
      const claims = client.decodeToken(client.currentToken());
      if (claims && user && claims.perms.join() !== user.perms.join()) setUser({ ...user, perms: claims.perms, roles: claims.roles });
    }, 30_000);
    return () => clearInterval(id);
  }, [status, user]);

  const finish = useCallback(async () => {
    const u = await loadUser();
    if (!u) {
      await client.logout();
      throw new Error('This account does not have access to the admin panel');
    }
    setUser(u);
    setStatus('signed-in');
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const r = await client.login(identifier, password);
    if (r.kind === 'done') await finish();
    return r;
  }, [finish]);

  const signInWithCode = useCallback(async (challenge: string, code: string) => {
    await client.loginWithCode(challenge, code);
    await finish();
  }, [finish]);

  const refreshUser = useCallback(async () => {
    const u = await loadUser();
    if (u) setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    clearDriverData();
    await client.logout().catch(() => client.clearLocalSession());
    setUser(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      can: (...perms: string[]) => !!user && perms.every((p) => user.perms.includes(p)),
      isDriver: !!user?.roles.includes('DELIVERY_AGENT'),
      driverOnly: !!user && user.perms.every((p) => p === 'delivery.update_own'),
      mustSetUpTwoFactor: !!user?.twoFactor?.required && !user.twoFactor.thisSession,
      signIn,
      signInWithCode,
      refreshUser,
      signOut,
    }),
    [status, user, signIn, signInWithCode, refreshUser, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
