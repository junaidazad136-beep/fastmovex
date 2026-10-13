/**
 * Browser API client for the admin panel.
 *
 * Session model:
 * - the API is told this is the admin panel ("X-Client-Type: admin"): only staff accounts can sign in, and the
 *   refresh token lives in its own httpOnly cookie (fmx_admin_rt), separate from the shop's customer session;
 * - the short-lived access token (15 min) lives only in memory;
 * - refreshing is serialized across tabs with the Web Locks API and the new token is shared over a BroadcastChannel,
 *   so two tabs never present the same single-use refresh token at the same time.
 */
import { ApiError, NetworkError } from './errors';

interface ClientConfig { apiUrl: string; country: string }

let config: ClientConfig = { apiUrl: 'http://localhost:4000/api/v1', country: 'QA' };
let accessToken: string | null = null;
let expiresAt = 0;
let refreshInFlight: Promise<boolean> | null = null;

const SESSION_HINT_KEY = 'fmx_admin_session';
const REFRESH_LOCK = 'fastmovex-admin-auth-refresh';
const EARLY_REFRESH_MS = 60_000;
const CLIENT_HEADERS = { 'x-client-type': 'admin', 'x-requested-with': 'fastmovex-web' } as const;

type AuthListener = (signedIn: boolean) => void;
const listeners = new Set<AuthListener>();

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel('fastmovex-admin-auth');
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

function storageGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage disabled: the session still works in this tab */ }
}

export function hasSessionHint(): boolean {
  return typeof window !== 'undefined' && storageGet(SESSION_HINT_KEY) === '1';
}

export function onAuthChange(fn: AuthListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentToken(): string | null {
  return accessToken;
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

/** Exchanges the admin refresh cookie for a new access token. Resolves false when there is no valid session. */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const run = async (): Promise<boolean> => {
    if (accessToken && expiresAt - Date.now() > EARLY_REFRESH_MS) return true;
    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...CLIENT_HEADERS },
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
  const locked = locks ? (locks.request(REFRESH_LOCK, run) as unknown as Promise<boolean>) : run();
  const p = locked.finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = p;
  return p;
}

async function validToken(): Promise<string | null> {
  if (accessToken && expiresAt - Date.now() > EARLY_REFRESH_MS) return accessToken;
  const ok = await refreshSession();
  return ok ? accessToken : null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, token: string, accept = 'application/json'): Promise<Response> {
  const headers: Record<string, string> = { accept, 'x-country': config.country, authorization: `Bearer ${token}`, ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(`${config.apiUrl}${path}`, { method: opts.method ?? 'GET', headers, body, credentials: 'include', signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new NetworkError(e);
  }
}

async function authed(path: string, opts: RequestOptions, accept?: string): Promise<Response> {
  let token = await validToken();
  if (!token) throw new ApiError(401, { message: 'Please sign in', statusCode: 401 });
  let res = await send(path, opts, token, accept);
  if (res.status === 401) {
    // Token revoked early (password changed, roles removed): one refresh, then give up.
    const ok = await refreshSession();
    token = ok ? accessToken : null;
    if (!token) throw new ApiError(401, { message: 'Session expired', statusCode: 401 });
    res = await send(path, opts, token, accept);
  }
  return res;
}

async function readError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
  }
  return new ApiError(res.status, data as ApiError['body']);
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await authed(path, opts);
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await readError(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Downloads a file answer (CSV export) and hands it to the browser as a save. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await authed(path, {}, 'text/csv, application/octet-stream, */*');
  if (!res.ok) throw await readError(res);
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
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opens a PDF the API makes (run sheet, cash receipt) in a new tab to print or save. The tab is opened before the
 * download so pop-up blockers allow it; if it was blocked, the file is saved instead.
 */
export async function openPdf(path: string, fallbackName: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const res = await authed(path, {}, 'application/pdf');
    if (!res.ok) throw await readError(res);
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url; a.download = fallbackName;
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export type LoginResult = { kind: 'done' } | { kind: 'code'; challenge: string };

async function postAuth(path: string, body: unknown): Promise<Record<string, unknown> & ApiError['body']> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...CLIENT_HEADERS },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new NetworkError(e);
  }
  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & ApiError['body']) | null;
  if (!res.ok || !data) throw new ApiError(res.status, data);
  return data;
}

/** Password step. With two-step sign-in on, no session yet: the caller asks for the code and calls loginWithCode. */
export async function login(identifier: string, password: string): Promise<LoginResult> {
  const data = await postAuth('/auth/login', { identifier, password });
  if (data.twoFactorRequired === true && typeof data.challenge === 'string') return { kind: 'code', challenge: data.challenge };
  if (typeof data.accessToken !== 'string') throw new ApiError(500, data);
  setSession(data.accessToken, Number(data.expiresIn));
  return { kind: 'done' };
}

/** Second step: the authenticator code (or a recovery code) with the challenge from login(). */
export async function loginWithCode(challenge: string, code: string): Promise<void> {
  const data = await postAuth('/auth/2fa/login', { challenge, code });
  if (typeof data.accessToken !== 'string') throw new ApiError(500, data);
  setSession(data.accessToken, Number(data.expiresIn));
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${config.apiUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...CLIENT_HEADERS },
      body: '{}',
    });
  } catch { /* offline: the local session is cleared anyway */ }
  clearLocalSession();
}

export interface TokenClaims { sub: string; roles: string[]; perms: string[]; exp: number }

/** Reads (does not verify) the access token's claims: used only to shape the UI. The API checks every call. */
export function decodeToken(token: string | null): TokenClaims | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const c = JSON.parse(json) as Partial<TokenClaims>;
    return { sub: String(c.sub), roles: c.roles ?? [], perms: c.perms ?? [], exp: c.exp ?? 0 };
  } catch {
    return null;
  }
}
