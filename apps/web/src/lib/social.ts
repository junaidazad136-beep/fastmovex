'use client';

import type { SocialProvider } from './api/types';

/**
 * Sign in with Google / Apple in the browser. The provider's own script shows its button or window and hands us an
 * ID token; the API checks it (signature, our client id, expiry and the nonce we chose here) before signing in.
 */
export const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
export const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const NONCE_KEY = 'fmx_social_nonce';

/** A fresh random nonce per attempt, kept for this tab only (the token must carry it back). */
export function newNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(NONCE_KEY, nonce); } catch { /* private mode: the value in memory is enough */ }
  return nonce;
}

const loading = new Map<string, Promise<void>>();
/** Loads a provider script once. */
export function loadScript(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading.delete(src); reject(new Error(`could not load ${src}`)); };
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}

/** Apple sends the name only the first time a person signs in, outside the token. */
export function appleName(user: unknown): string | undefined {
  const n = (user as { name?: { firstName?: string; lastName?: string } } | undefined)?.name;
  const full = [n?.firstName, n?.lastName].filter(Boolean).join(' ').trim();
  return full.length >= 2 ? full.slice(0, 100) : undefined;
}

export const providerLabel: Record<SocialProvider, string> = { GOOGLE: 'Google', APPLE: 'Apple' };

/* Minimal typings of the provider scripts we call. */
export interface GoogleId {
  accounts: {
    id: {
      initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; nonce: string; ux_mode?: 'popup'; auto_select?: boolean; itp_support?: boolean; use_fedcm_for_prompt?: boolean }): void;
      renderButton(el: HTMLElement, o: { theme?: string; size?: string; text?: string; shape?: string; width?: number; locale?: string; logo_alignment?: string }): void;
    };
  };
}
export interface AppleId {
  auth: {
    init(o: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; nonce: string; state?: string }): void;
    signIn(): Promise<{ authorization: { id_token: string; code?: string; state?: string }; user?: unknown }>;
  };
}
