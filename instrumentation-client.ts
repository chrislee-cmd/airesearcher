// instrumentation-client.ts — runs before React hydration (PR-SEC12).
//
// We delegate to sentry.client.config.ts so the actual init lives next
// to its server/edge counterparts. Sentry.init no-ops when DSN is unset.

import './sentry.client.config';
