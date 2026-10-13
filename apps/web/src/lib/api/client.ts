/**
 * Browser API client.
 *
 * Session model (matches the API's web mode):
 * - the refresh token lives in an httpOnly, SameSite=Strict cookie scoped to /api/v1/auth — JavaScript never sees it;
 * - the short-lived access token (15 min) lives only in memory;
 * - refreshing is serialized across tabs with the Web Locks API and the new token is shared over a BroadcastChannel,
 *   so two tabs never present the same single-use refresh token at the same time.
 */
import { ApiError, NetworkError } from './errors';
import type { TwoFactorChallenge } from './types';

type AuthMode = 'none' | 'optional' | 'required';

interface ClientConfig { apiUrl: string; country: string }

let config: ClientConfig = { apiUrl: 'http://localhost:4000/api/v1', country: 'QA' };
let accessToken: string | null = null;
let expiresAt = 0;
let refreshInFlight: Promise<boolean> | null = null;

const SESSION_HINT_KEY = 'jovia_session';
const CART_TOKEN_KEY = 'jovia_cart';
const REFRESH_LOCK = 'jovia-auth-refresh';
const EARLY_REFRESH_MS = 60_000;

type AuthListener = (signedIn: boolean) => void;
const listeners = new Set<AuthListener>();

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel('jovia-auth');
    channel.onmessage = (e: MessageEvent<{ type: 'token'; token: string; expiresAt: number } | { type: 'signed-out' }>) => {
      if (e.data.type === 'token') {
        accessToken = e.data.token;
        expiresAt = e.data.expiresAt;
      } else if (e.data.type === 'signed-out') {
        clearLocalSession(false);
      }
    };
  }
  return channel;
}

export function configureApi(c: ClientConfig) {
  config = c;
  getChannel();
}

export function apiUrl() {
  return config.apiUrl;
}

export function apiCountry() {
  return config.country;
}

// ------------------------------------------------------------------ storage helpers (never throw)

function storageGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private mode / storage disabled: the session still works for this tab */ }
}

export function hasSessionHint(): boolean {
  return typeof window !== 'undefined' && storageGet(SESSION_HINT_KEY) === '1';
}

export function getCartToken(): string | null {
  return typeof window === 'undefined' ? null : storageGet(CART_TOKEN_KEY);
}
export function setCartToken(token: string | null) {
  storageSet(CART_TOKEN_KEY, token);
}

// ------------------------------------------------------------------ session

export function onAuthChange(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSession(token: string, expiresInSeconds: number, broadcast = true) {
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1000;
  storageSet(SESSION_HINT_KEY, '1');
  if (broadcast) getChannel()?.postMessage({ type: 'token', token, expiresAt });
}

export function clearLocalSession(broadcast = true) {
  const had = accessToken !== null || hasSessionHint();
  accessToken = null;
  expiresAt = 0;
  storageSet(SESSION_HINT_KEY, null);
  if (broadcast) getChannel()?.postMessage({ type: 'signed-out' });
  if (had) listeners.forEach((l) => l(false));
}

export function isSignedIn(): boolean {
  return accessToken !== null;
}

/**
 * Exchanges the refresh cookie for a new access token. Resolves false when there is no valid session.
 * `force`: even when the current token is still fresh — after the account gained a role (e.g. opening a seller account)
 * the new token carries it.
 */
export function refreshSession(force = false): Promise<boolean> {
  if (refreshInFlight && !force) return refreshInFlight;
  const run = async (): Promise<boolean> => {
    // Another tab may have refreshed while this one waited for the lock.
    if (!force && accessToken && expiresAt - Date.now() > EARLY_REFRESH_MS) return true;
    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'jovia-web' },
        body: '{}',
      });
    } catch (e) {
      throw new NetworkError(e);
    }
    if (!res.ok) {
      clearLocalSession();
      return false;
    }
    const data = (await res.json()) as { accessToken: string; expiresIn: number };
    setSession(data.accessToken, data.expiresIn);
    return true;
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  // Web Locks resolve with the callback's own promise result; typed loosely by lib.dom.
  const locked = locks ? (locks.request(REFRESH_LOCK, run) as unknown as Promise<boolean>) : run();
  const p = locked.finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = p;
  return p;
}

async function validToken(): Promise<string | null> {
  if (accessToken && expiresAt - Date.now() > EARLY_REFRESH_MS) return accessToken;
  if (!accessToken && !hasSessionHint()) return null;
  const ok = await refreshSession();
  return ok ? accessToken : null;
}

// ------------------------------------------------------------------ requests

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: AuthMode;
  /** Send the guest cart token (cart endpoints for visitors who are not signed in). */
  cart?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-country': config.country, ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.cart && !token) {
    const ct = getCartToken();
    if (ct) headers['x-cart-token'] = ct;
  }
  try {
    return await fetch(`${config.apiUrl}${path}`, { method: opts.method ?? 'GET', headers, body, credentials: 'include', signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new NetworkError(e);
  }
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const mode = opts.auth ?? 'required';
  let token = mode === 'none' ? null : await validToken();
  if (mode === 'required' && !token) throw new ApiError(401, { message: 'Please sign in', statusCode: 401 });

  let res = await send(path, opts, token);
  if (res.status === 401 && token) {
    // Token revoked or expired early (e.g. password changed on another device): try one refresh.
    const ok = await refreshSession();
    token = ok ? accessToken : null;
    if (!token && mode === 'required') throw new ApiError(401, { message: 'Session expired', statusCode: 401 });
    res = await send(path, opts, token);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (!res.ok) throw new ApiError(res.status, data as ApiError['body']);
  return data as T;
}

/**
 * A file the API makes (invoice, credit note, my-data export): fetched with the same sign-in (or the guest order
 * token in `opts.headers`), then saved by the browser. A tab cannot send the Authorization header, hence the blob.
 */
/**
 * Opens a PDF the API makes (shipping label, packing list) in a new tab, ready to print. Call it straight from the
 * click: the tab is opened before the download so pop-up blockers allow it. If the tab is blocked anyway, the file
 * is saved instead; resolves to false in that case.
 */
export async function openPdf(path: string, fallbackName: string, opts: RequestOptions = {}): Promise<boolean> {
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const { blob, name } = await fetchFile(path, fallbackName, opts);
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    if (tab && !tab.closed) {
      tab.location.href = url;
      return true;
    }
    saveBlob(url, name);
    return false;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

function saveBlob(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function fetchFile(path: string, fallbackName: string, opts: RequestOptions = {}): Promise<{ blob: Blob; name: string }> {
  const mode = opts.auth ?? 'required';
  let token = mode === 'none' ? null : await validToken();
  if (mode === 'required' && !token) throw new ApiError(401, { message: 'Please sign in', statusCode: 401 });
  let res = await send(path, { ...opts, headers: { ...opts.headers } }, token);
  if (res.status === 401 && token) {
    const ok = await refreshSession();
    token = ok ? accessToken : null;
    res = await send(path, opts, token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    throw new ApiError(res.status, data as ApiError['body']);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? fallbackName;
  return { blob: await res.blob(), name: decodeURIComponent(name) };
}

export async function downloadFile(path: string, fallbackName: string, opts: RequestOptions = {}): Promise<void> {
  const mode = opts.auth ?? 'required';
  let token = mode === 'none' ? null : await validToken();
  if (mode === 'required' && !token) throw new ApiError(401, { message: 'Please sign in', statusCode: 401 });
  let res = await send(path, { ...opts, headers: { ...opts.headers } }, token);
  if (res.status === 401 && token) {
    const ok = await refreshSession();
    token = ok ? accessToken : null;
    res = await send(path, opts, token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    throw new ApiError(res.status, data as ApiError['body']);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = decodeURIComponent(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Login / register answer: access token in the body, refresh token set as an httpOnly cookie by the API.
 * An account with two-step sign-in answers /auth/login with a challenge instead (no tokens, no cookie):
 * that is returned, and the sign-in finishes with the code at /auth/2fa/login.
 */
export async function authRequest(path: '/auth/login' | '/auth/register' | '/auth/2fa/login' | '/auth/social', body: unknown): Promise<TwoFactorChallenge | null> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-country': config.country },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new NetworkError(e);
  }
  const data = (await res.json().catch(() => null)) as ({ accessToken?: string; expiresIn: number; twoFactorRequired?: boolean; challenge?: string } & ApiError['body']) | null;
  if (res.ok && (path === '/auth/login' || path === '/auth/social') && data?.twoFactorRequired === true && typeof data.challenge === 'string') {
    return { twoFactorRequired: true, challenge: data.challenge, expiresIn: data.expiresIn };
  }
  if (!res.ok || !data?.accessToken) throw new ApiError(res.status, data);
  setSession(data.accessToken, data.expiresIn);
  return null;
}

export async function logoutRequest(everywhere = false): Promise<void> {
  try {
    if (everywhere) await api('/auth/logout-all', { method: 'POST' });
    else {
      await fetch(`${config.apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'jovia-web' },
        body: '{}',
      });
    }
  } finally {
    clearLocalSession();
  }
}
