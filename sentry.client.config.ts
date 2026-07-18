// sentry.client.config.ts — Sentry init for the browser (PR-SEC12).
//
// Loaded by `instrumentation-client.ts`. `NEXT_PUBLIC_SENTRY_DSN` is
// the browser-exposed DSN — distinct from server `SENTRY_DSN` so we can
// disable client capture without touching server reporting.

import * as Sentry from '@sentry/nextjs';
import { sanitizeSentryEvent, SENTRY_TRACES_SAMPLE_RATE } from '@/lib/sentry-pii';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  sendDefaultPii: false,
  beforeSend: sanitizeSentryEvent,
});
