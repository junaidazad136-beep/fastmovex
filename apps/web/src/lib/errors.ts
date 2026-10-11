import { ApiError, NetworkError } from './api/errors';
import type { T } from './i18n';

/** A message a shopper can act on, in their language where we know the case, else the API's explanation. */
export function errorMessage(e: unknown, t: T): string {
  if (e instanceof NetworkError) return t('errors.network');
  if (e instanceof ApiError) {
    if (e.status === 429 && e.reason === 'ACCOUNT_LOCKED') return lockedMessage(e, t);
    if (e.status === 429) return t('errors.tooMany');
    if (e.status === 401) return t('auth.sessionExpired');
    if (e.status >= 500) return t('errors.generic');
    return e.message || t('errors.generic');
  }
  return t('errors.generic');
}

/**
 * Too many wrong passwords or codes: the account is paused for a while (HTTP 429, reason ACCOUNT_LOCKED).
 * Says for how many minutes, in the shopper's language; falls back to the API's own explanation.
 */
export function lockedMessage(e: ApiError, t: T): string {
  const seconds = Number(e.body?.retryAfterSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return t.plural('auth.locked', Math.max(1, Math.ceil(seconds / 60)));
  return e.message || t('errors.tooMany');
}
