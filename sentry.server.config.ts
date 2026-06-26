// sentry.server.config.ts — Sentry init for Node.js runtime (PR-SEC12).
//
// Loaded by `instrumentation.ts` when `NEXT_RUNTIME === 'nodejs'`. With
// no `SENTRY_DSN` set, `Sentry.init` is a no-op — the file still loads
// so wiring is verified in preview/CI even when DSN is missing.
//
// PII filtering happens in `beforeSend` (see src/lib/sentry-pii.ts).
// `sendDefaultPii: false` keeps Sentry's own auto-attached headers /
// cookies / ip from leaving the process before our redactor runs.

import * as Sentry from '@sentry/nextjs';
import { sanitizeSentryEvent, SENTRY_TRACES_SAMPLE_RATE } from '@/lib/sentry-pii';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  // Strip cookies / IP / Authorization headers Sentry would otherwise
  // auto-attach. Our beforeSend layer is the second wall.
  sendDefaultPii: false,
  beforeSend: sanitizeSentryEvent,
});
