'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { disablePush } from '../push';
import { api, authRequest, clearLocalSession, hasSessionHint, logoutRequest, onAuthChange, refreshSession } from '../api/client';
import type { Me, TwoFactorChallenge } from '../api/types';

type Status = 'loading' | 'guest' | 'user';

export interface RegisterInput {
  fullName: string;
  email?: string;
  phone?: string;
  password: string;
  locale: 'en' | 'ar';
  countryCode: string;
}

interface SessionValue {
  status: Status;
  user: Me | null;
  /** Signs in, or — when the account has two-step sign-in on — returns the challenge for `loginWithCode`. */
  login: (identifier: string, password: string) => Promise<Me | TwoFactorChallenge>;
  /** Sign in (or sign up) with a Google / Apple ID token; may return a two-step challenge like `login`. */
  loginSocial: (input: { provider: 'GOOGLE' | 'APPLE'; idToken: string; nonce: string; fullName?: string; locale: string }) => Promise<Me | TwoFactorChallenge>;
  /** Second step: the authenticator code (or a recovery code) for the challenge from `login`. */
  loginWithCode: (challenge: string, code: string) => Promise<Me>;
  register: (input: RegisterInput) => Promise<Me>;
  logout: (everywhere?: boolean) => Promise<void>;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);

  const loadMe = useCallback(async () => {
    const me = await api<Me>('/auth/me');
    setUser(me);
    setStatus('user');
    return me;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasSessionHint()) { setStatus('guest'); return; }
      try {
        const ok = await refreshSession();
        if (!cancelled) {
          if (ok) await loadMe();
          else setStatus('guest');
        }
      } catch {
        // Offline or API down: behave as a guest until the next action retries.
        if (!cancelled) setStatus('guest');
      }
    })();
    const off = onAuthChange((signedIn) => {
      if (!signedIn) { setUser(null); setStatus('guest'); }
    });
    return () => { cancelled = true; off(); };
  }, [loadMe]);

  const login = useCallback(async (identifier: string, password: string): Promise<Me | TwoFactorChallenge> => {
    const challenge = await authRequest('/auth/login', { identifier, password });
    if (challenge) return challenge;
    return loadMe();
  }, [loadMe]);

  const loginSocial = useCallback(async (input: { provider: 'GOOGLE' | 'APPLE'; idToken: string; nonce: string; fullName?: string; locale: string }): Promise<Me | TwoFactorChallenge> => {
    const challenge = await authRequest('/auth/social', input);
    if (challenge) return challenge;
    return loadMe();
  }, [loadMe]);

  const loginWithCode = useCallback(async (challenge: string, code: string) => {
    await authRequest('/auth/2fa/login', { challenge, code });
    return loadMe();
  }, [loadMe]);

  const register = useCallback(async (input: RegisterInput) => {
    await authRequest('/auth/register', input);
    return loadMe();
  }, [loadMe]);

  const logout = useCallback(async (everywhere = false) => {
    // a shared computer must not keep showing the previous person's order updates
    await disablePush().catch(() => undefined);
    try { await logoutRequest(everywhere); } catch { clearLocalSession(); }
    setUser(null);
    setStatus('guest');
  }, []);

  const reload = useCallback(async () => { await loadMe(); }, [loadMe]);

  const value = useMemo(() => ({ status, user, login, loginSocial, loginWithCode, register, logout, reload }), [status, user, login, loginSocial, loginWithCode, register, logout, reload]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
