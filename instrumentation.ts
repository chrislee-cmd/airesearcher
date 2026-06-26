// instrumentation.ts — Next.js 16 server-side init hook (PR-SEC12).
//
// Next.js calls `register` once per server process. We dispatch to the
// runtime-specific Sentry config based on NEXT_RUNTIME so the Edge
// bundle never imports the Node config (and vice versa).

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Forward server-rendered / route-handler errors to Sentry. Sentry's
// own `captureRequestError` already applies our `beforeSend` PII filter,
// so we don't need to re-sanitize here.
export const onRequestError = Sentry.captureRequestError;
