/**
 * Error reporting (Sentry). Loaded before anything else in main.ts so it can hook into Node.
 * Off unless SENTRY_DSN is set. No personal data: no IPs, cookies, auth headers, request bodies or user emails/phones.
 */
import * as Sentry from '@sentry/nestjs';

const SECRET_HEADERS = /^(authorization|cookie|set-cookie|x-cart-token|x-fmx-edge-key|x-fmx-client-ip|x-guest-token|x-csrf.*)$/i;

const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    beforeSend(event) {
      const req = event.request;
      if (req) {
        delete req.cookies;
        delete req.data; // bodies can hold addresses, phones, passwords
        if (req.headers) for (const k of Object.keys(req.headers)) if (SECRET_HEADERS.test(k)) delete req.headers[k];
        if (req.query_string) req.query_string = '[removed]';
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      return event;
    },
  });
}
