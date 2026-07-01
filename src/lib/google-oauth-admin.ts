// Admin-proxy OAuth helper for the recruiting publish flow.
//
// Every published Google Form / linked Sheet must land in a single
// admin account (GOOGLE_ADMIN_EMAIL) so the operator can audit recruit
// responses across all users from one Drive. The user-facing browser
// never touches the admin tokens — only server routes import this
// module.
//
// We pre-stage a long-lived `refresh_token` for the admin via Vercel
// env. Each request exchanges it for a short-lived access token (1h)
// via Google's token endpoint, with a small in-memory cache so we don't
// hit oauth2.googleapis.com on every recruiting API call.

import * as Sentry from '@sentry/nextjs';

import { env } from '@/env';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

// True when both halves of the admin proxy env are populated. Other
// modules use this to decide between admin and legacy per-user paths
// without each having to read env directly. Returns false on the
// browser bundle — env is server-only so callers must already be in a
// route handler / server action.
export function isAdminProxyConfigured(): boolean {
  return (
    typeof env.GOOGLE_ADMIN_REFRESH_TOKEN === 'string' &&
    env.GOOGLE_ADMIN_REFRESH_TOKEN.length > 0 &&
    typeof env.GOOGLE_ADMIN_EMAIL === 'string' &&
    env.GOOGLE_ADMIN_EMAIL.length > 0
  );
}

export function getAdminEmail(): string | null {
  return env.GOOGLE_ADMIN_EMAIL ?? null;
}

// Throws when admin proxy env is missing. Callers that have already
// gated on isAdminProxyConfigured() can rely on a non-empty string back.
export async function getAdminAccessToken(): Promise<string> {
  const refreshToken = env.GOOGLE_ADMIN_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('admin_refresh_token_missing');
  }

  // 60s skew so a token that's about to expire mid-call is refreshed
  // proactively. The Forms API rejects expired bearers with a 401 that
  // surfaces as a confusing "publish_failed" to the user otherwise.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('missing_google_oauth_env');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    // A failed refresh means the admin proxy is dead until someone
    // re-runs the OAuth flow and updates GOOGLE_ADMIN_REFRESH_TOKEN — so
    // every recruiting publish silently falls back to the legacy
    // per-user path. `invalid_grant` specifically means the token was
    // revoked/expired (password change, Google security check, 7-day
    // testing-mode cap). Alert loudly; the runbook in
    // docs/GOOGLE_ADMIN_PROXY_SETUP.md has the recovery steps. The txt
    // body carries no user PII (Google's own error JSON), but sentry-pii
    // still scrubs token-shaped strings as defense in depth.
    const invalidGrant = txt.includes('invalid_grant');
    Sentry.captureMessage('google_admin_refresh_token_failed', {
      level: 'error',
      tags: { invalid_grant: invalidGrant },
      extra: { email: env.GOOGLE_ADMIN_EMAIL, status: res.status, body: txt },
    });
    throw new Error(`admin_token_refresh_failed: ${res.status} ${txt}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// Test/diagnostics hook — clears the in-memory cache so the next call
// re-exchanges the refresh token. Production code never needs this.
export function __resetAdminTokenCache(): void {
  cached = null;
}
