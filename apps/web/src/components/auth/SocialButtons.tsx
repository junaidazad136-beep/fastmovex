'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { SocialProvider, SocialProviders, TwoFactorChallenge } from '@/lib/api/types';
import { errorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { useSession } from '@/lib/state/session';
import { APPLE_SCRIPT, appleName, type AppleId, GOOGLE_SCRIPT, type GoogleId, loadScript, newNonce } from '@/lib/social';
import { Spinner } from '../ui/Spinner';
import { FormError } from './fields';

declare global {
  interface Window { google?: GoogleId; AppleID?: AppleId }
}

let cached: Promise<SocialProviders> | null = null;
function providers() {
  cached ??= api<SocialProviders>('/auth/social/providers', { auth: 'none' }).catch(() => { cached = null; return { google: null, apple: null }; });
  return cached;
}

/**
 * "Continue with Google / Apple" on the sign-in and sign-up pages. Shown only for the providers the shop has set up.
 * Two-step sign-in still applies: the challenge goes back to the page, which asks for the code.
 */
export function SocialButtons({ onDone, onChallenge }: { onDone: (created: boolean) => void; onChallenge?: (c: TwoFactorChallenge) => void }) {
  const t = useT();
  const l = t.locale;
  const { loginSocial } = useSession();
  const [cfg, setCfg] = useState<SocialProviders | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');
  const googleRef = useRef<HTMLDivElement>(null);

  useEffect(() => { let off = false; providers().then((p) => { if (!off) setCfg(p); }); return () => { off = true; }; }, []);

  async function finish(provider: SocialProvider, idToken: string, nonce: string, fullName?: string) {
    setBusy(provider); setError('');
    try {
      const r = await loginSocial({ provider, idToken, nonce, fullName, locale: l });
      if ('twoFactorRequired' in r) {
        if (onChallenge) onChallenge(r); else setError(t('auth.social.useLogin'));
        setBusy(null);
        return;
      }
      onDone(false);
    } catch (e) {
      const reason = e instanceof ApiError ? e.reason : undefined;
      setError(reason === 'SOCIAL_NO_EMAIL' ? t('auth.social.noEmail') : reason === 'STAFF_ACCOUNT' ? t('auth.social.staff') : reason === 'SOCIAL_TOKEN' || reason === 'SOCIAL_NONCE' ? t('auth.social.failed') : errorMessage(e, t));
      setBusy(null);
    }
  }

  // Google draws its own button (required by Google's brand rules) into our box
  useEffect(() => {
    const clientId = cfg?.google;
    const box = googleRef.current;
    if (!clientId || !box) return;
    let off = false;
    loadScript(GOOGLE_SCRIPT).then(() => {
      if (off || !window.google) return;
      const nonce = newNonce();
      window.google.accounts.id.initialize({
        client_id: clientId, nonce, ux_mode: 'popup', auto_select: false, itp_support: true,
        callback: (r) => { if (r.credential) void finish('GOOGLE', r.credential, nonce); },
      });
      window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: Math.min(400, box.clientWidth || 320), locale: l, logo_alignment: 'center' });
    }).catch(() => { if (!off) setError(t('auth.social.unavailable')); });
    return () => { off = true; };
    // finish is stable enough for this one-time setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.google, l]);

  async function apple() {
    if (!cfg?.apple) return;
    setError('');
    try {
      await loadScript(APPLE_SCRIPT);
      if (!window.AppleID) throw new Error('Apple sign-in did not load');
      const nonce = newNonce();
      window.AppleID.auth.init({ clientId: cfg.apple, scope: 'name email', redirectURI: `${window.location.origin}/${l}/login`, usePopup: true, nonce });
      const r = await window.AppleID.auth.signIn();
      await finish('APPLE', r.authorization.id_token, nonce, appleName(r.user));
    } catch (e) {
      // closing the Apple window is not an error worth showing
      if ((e as { error?: string })?.error === 'popup_closed_by_user') return;
      setError(t('auth.social.unavailable'));
    }
  }

  if (!cfg || (!cfg.google && !cfg.apple)) return null;
  return (
    <div className="mt-6 space-y-3" data-testid="social-sign-in">
      <div className="flex items-center gap-3 text-xs text-ink-400" aria-hidden>
        <span className="h-px flex-1 bg-ink-100" />{t('auth.social.or')}<span className="h-px flex-1 bg-ink-100" />
      </div>
      <FormError message={error} />
      {busy && <p className="flex items-center justify-center gap-2 text-sm text-ink-600" role="status"><Spinner className="size-4" />{t('auth.signingIn')}</p>}
      {cfg.google && <div ref={googleRef} className="flex min-h-11 justify-center" data-testid="google-button" />}
      {cfg.apple && (
        <button type="button" onClick={apple} disabled={!!busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-black px-4 text-sm font-semibold text-white hover:bg-black/85 disabled:opacity-60" data-testid="apple-button">
          <svg viewBox="0 0 17 20" className="size-4 fill-current" aria-hidden><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.8 1.3 10.3.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.2zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" /></svg>
          {t('auth.social.apple')}
        </button>
      )}
    </div>
  );
}
