/** Server-side error reporting (Sentry). Off unless SENTRY_DSN is set. No personal data is sent. */
import * as Sentry from '@sentry/nextjs';

const SECRET_HEADERS = /^(authorization|cookie|set-cookie|x-cart-token|x-fmx-edge-key|x-fmx-client-ip|x-guest-token|x-csrf.*)$/i;

export function register() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    beforeSend(event) {
      const req = event.request;
      if (req) {
        delete req.cookies;
        delete req.data;
        if (req.headers) for (const k of Object.keys(req.headers)) if (SECRET_HEADERS.test(k)) delete req.headers[k];
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
