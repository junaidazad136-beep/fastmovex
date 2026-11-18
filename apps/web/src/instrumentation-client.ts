/**
 * Browser error reporting (Sentry). Off unless NEXT_PUBLIC_SENTRY_DSN is set at build time.
 * Events go to our own /api/monitor (tunnel), so the strict CSP and ad blockers don't drop them.
 * No session replay, no IPs, no form contents.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    // extensions and old in-app browsers make noise that is not ours
    ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured', /^Script error\.?$/],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//],
    beforeSend(event) {
      if (event.request) { delete event.request.cookies; delete event.request.data; }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
