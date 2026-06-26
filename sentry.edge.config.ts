// sentry.edge.config.ts — Sentry init for the Edge runtime (PR-SEC12).
//
// Loaded by `instrumentation.ts` when `NEXT_RUNTIME === 'edge'`. Same
// shape as the Node config (single PII redactor) — kept as a separate
// file because @sentry/nextjs ships runtime-specific bundles.

import * as Sentry from '@sentry/nextjs';
import { sanitizeSentryEvent, SENTRY_TRACES_SAMPLE_RATE } from '@/lib/sentry-pii';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  sendDefaultPii: false,
  beforeSend: sanitizeSentryEvent,
});
