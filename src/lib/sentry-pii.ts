// sentry-pii.ts — Sentry `beforeSend` PII redactor (PR-SEC12).
//
// Mounted from sentry.{client,server,edge}.config.ts so every Sentry
// event passes through one allowlist before leaving the process.
//
// What we strip:
//   - event.user.email / username / ip_address  → keep id only
//   - event.request.cookies / Authorization & Cookie headers
//   - event.request.data — body of POSTs to our PII-bearing routes
//     (transcripts, interviews, voice, translate, account, billing).
//     We don't try to detect PII inside arbitrary JSON — instead we
//     drop the whole body for those paths.
//   - event.extra / event.contexts string values matching obvious PII
//     shapes (email, JWT, bearer tokens, Korean phone numbers).
//
// What we keep: error type, message, stack, route, status code, breadcrumbs
// minus their data fields. Sentry already scrubs known secret keys via
// `sendDefaultPii: false`; this is defense in depth on top of that.

import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// Routes whose request body is treated as opaque PII. Anything under
// these prefixes gets `event.request.data` dropped wholesale. Add to
// this list when a new route accepts PII (transcripts, interview text,
// payment info, etc.) so we never need to remember per-field redaction.
const PII_ROUTE_PREFIXES: readonly string[] = [
  '/api/account/',
  '/api/auth/',
  '/api/audit/',
  '/api/billing/',
  '/api/consent',
  '/api/desk',
  '/api/insights/',
  '/api/interviews/',
  '/api/probing/',
  '/api/recruiting/',
  '/api/reports/',
  '/api/share/',
  '/api/transcripts/',
  '/api/translate/',
  '/api/video/',
  '/api/voice/',
];

const PII_HEADER_KEYS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-supabase-auth',
  'x-api-key',
  'x-csrf-token',
];

// Patterns we redact inside any free-form string we forward (extra,
// contexts, breadcrumb messages). Conservative — we'd rather drop a
// legitimate token than ship a real one to Sentry.
const REDACT_PATTERNS: ReadonlyArray<{ re: RegExp; tag: string }> = [
  // Email
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, tag: '[redacted-email]' },
  // JWT / Supabase access tokens
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, tag: '[redacted-jwt]' },
  // Bearer/secret tokens
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, tag: 'Bearer [redacted]' },
  // Korean phone numbers (010-1234-5678 / 01012345678)
  { re: /\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, tag: '[redacted-phone]' },
];

const REDACTED_MARK = '[redacted]';

function redactString(input: string): string {
  let out = input;
  for (const { re, tag } of REDACT_PATTERNS) {
    out = out.replace(re, tag);
  }
  return out;
}

function isPiiRoute(path: string | undefined): boolean {
  if (!path) return false;
  return PII_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function redactHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string | string[] | undefined> | undefined {
  if (!headers) return headers;
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = PII_HEADER_KEYS.includes(k.toLowerCase()) ? REDACTED_MARK : v;
  }
  return out;
}

// Shallow walker: only descends into plain objects / arrays. Strings get
// pattern-redacted, everything else passes through. Cycles are not a
// concern — Sentry already serializes events to JSON before we see them
// in beforeSend, so anything cyclic is already broken.
function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 5) return REDACTED_MARK as unknown as T;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Sanitize a Sentry event before it leaves the process. Always returns
 * the event (never drops) so we don't accidentally swallow useful crash
 * data; if you need to drop an event, return `null` from this function.
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent | null {
  // user — keep id only.
  if (event.user) {
    const { id } = event.user;
    event.user = id ? { id: String(id) } : undefined;
  }

  // request — drop body on PII routes, scrub headers + cookies always.
  if (event.request) {
    const req = event.request;
    if (req.headers) {
      req.headers = redactHeaders(
        req.headers as Record<string, string | string[] | undefined>,
      ) as typeof req.headers;
    }
    if (req.cookies) {
      req.cookies = REDACTED_MARK as unknown as typeof req.cookies;
    }
    if (req.query_string && typeof req.query_string === 'string') {
      req.query_string = redactString(req.query_string);
    }
    if (req.data !== undefined && isPiiRoute(req.url)) {
      req.data = REDACTED_MARK;
    } else if (req.data !== undefined) {
      req.data = redactDeep(req.data);
    }
  }

  // extra / contexts — recursive string redaction.
  if (event.extra) {
    event.extra = redactDeep(event.extra);
  }
  if (event.contexts) {
    event.contexts = redactDeep(event.contexts);
  }

  // breadcrumb messages may contain user input echoed via log statements.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b: Breadcrumb) => ({
      ...b,
      message: b.message ? redactString(b.message) : b.message,
      data: b.data ? redactDeep(b.data) : b.data,
    }));
  }

  return event;
}

export const SENTRY_SAMPLE_RATE = 1.0;
export const SENTRY_TRACES_SAMPLE_RATE = 0.1;
