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
import { createAdminClient } from '@/lib/supabase/admin';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Clean error code thrown when every admin refresh_token source (DB + env)
// is exhausted. Routes map this to 503 + a friendly "operator must reconnect
// Google" payload — the raw Google `invalid_grant` JSON never reaches the
// client.
export const ADMIN_REAUTH_ERROR = 'admin_google_reauth_required';

// Where the operator (admin) is sent to redo the Google OAuth consent flow.
// The callback route overwrites the stored refresh_token in user_google_oauth,
// which the DB-first resolver below then picks up automatically — so a single
// in-app "Google 재연결" click self-heals the proxy with no env edit / redeploy.
const ADMIN_REAUTH_START_URL = '/api/recruiting/google/start';

type TokenSource = 'db' | 'env';
type CachedToken = { token: string; expiresAt: number; source: TokenSource };
let cached: CachedToken | null = null;

export function getAdminEmail(): string | null {
  return env.GOOGLE_ADMIN_EMAIL ?? null;
}

// True when the given email is the configured admin-proxy operator. Used
// server-side to decide whether to surface a self-service "재연결" CTA — we
// never send GOOGLE_ADMIN_EMAIL to the browser, so the comparison stays here.
export function isAdminUserEmail(email: string | null | undefined): boolean {
  const adminEmail = env.GOOGLE_ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}

// Shared 503 body for admin-reauth failures. Every route that touches the
// admin token uses this so the payload shape can't diverge. The reauth_url
// (self-service CTA target) is only included for the admin operator — a
// regular user gets the informational banner without the button.
export function adminReauthErrorBody(
  requesterEmail: string | null | undefined,
): Record<string, string> {
  const body: Record<string, string> = {
    error: ADMIN_REAUTH_ERROR,
    message: '운영자 Google 연결 갱신이 필요해요. 잠시 후 다시 시도해 주세요.',
  };
  if (isAdminUserEmail(requesterEmail)) {
    body.reauth_url = ADMIN_REAUTH_START_URL;
  }
  return body;
}

// Fetches the freshest admin refresh_token stored in the DB — written by the
// OAuth callback whenever the operator (email = GOOGLE_ADMIN_EMAIL) reconnects
// Google in-app. Service-role read; never logged. Returns null on any miss so
// the caller can fall back to the env token. limit(1) over updated_at guards
// against duplicate rows for the same email.
async function getAdminDbRefreshToken(): Promise<string | null> {
  const email = env.GOOGLE_ADMIN_EMAIL;
  if (!email) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('user_google_oauth')
      .select('refresh_token, updated_at')
      .eq('email', email)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const token = (data as { refresh_token?: string | null } | null)
      ?.refresh_token;
    return token && token.length > 0 ? token : null;
  } catch {
    // DB unreachable / schema drift → treat as "no DB token" and let env
    // fallback carry the request. Never surface DB internals to callers.
    return null;
  }
}

function getAdminEnvRefreshToken(): string | null {
  const t = env.GOOGLE_ADMIN_REFRESH_TOKEN;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

// Ordered candidate refresh tokens: DB first (always current, self-heals when
// the operator reconnects), env second (legacy pre-staged token, backwards
// compat). A failed refresh on the primary transparently retries the other
// source — covering both "DB dead, env alive" and "env dead, DB alive".
async function resolveAdminRefreshTokens(): Promise<
  { token: string; source: TokenSource }[]
> {
  const dbToken = await getAdminDbRefreshToken();
  const envToken = getAdminEnvRefreshToken();
  const candidates: { token: string; source: TokenSource }[] = [];
  if (dbToken) candidates.push({ token: dbToken, source: 'db' });
  // Skip env when it's byte-identical to the DB token — retrying the same
  // string can't turn an invalid_grant into a success.
  if (envToken && envToken !== dbToken) {
    candidates.push({ token: envToken, source: 'env' });
  }
  return candidates;
}

// The admin-proxy is usable when the operator email is set AND at least one
// refresh_token source exists (DB row OR env). Env is checked first (sync, no
// DB hit on the happy path); only when the env token is absent do we probe the
// DB — so an expired-but-present env string still short-circuits here and the
// self-heal retry happens inside getAdminAccessToken().
export async function isAdminProxyConfigured(): Promise<boolean> {
  if (!env.GOOGLE_ADMIN_EMAIL || env.GOOGLE_ADMIN_EMAIL.length === 0) {
    return false;
  }
  if (getAdminEnvRefreshToken()) return true;
  return (await getAdminDbRefreshToken()) !== null;
}

type RefreshFailure = { invalidGrant: boolean; status: number; body: string };

async function exchangeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<
  | { ok: true; token: string; expiresIn: number }
  | { ok: false; failure: RefreshFailure }
> {
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
    return {
      ok: false,
      failure: {
        invalidGrant: txt.includes('invalid_grant'),
        status: res.status,
        body: txt,
      },
    };
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return { ok: true, token: data.access_token, expiresIn: data.expires_in };
}

// Throws `admin_refresh_token_missing` when no source exists at all, or
// ADMIN_REAUTH_ERROR when every source's refresh fails. Callers that already
// gated on isAdminProxyConfigured() can rely on a non-empty string back.
export async function getAdminAccessToken(): Promise<string> {
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

  const candidates = await resolveAdminRefreshTokens();
  if (candidates.length === 0) {
    throw new Error('admin_refresh_token_missing');
  }

  let lastFailure: RefreshFailure | null = null;
  for (const candidate of candidates) {
    const outcome = await exchangeRefreshToken(
      candidate.token,
      clientId,
      clientSecret,
    );
    if (outcome.ok) {
      cached = {
        token: outcome.token,
        expiresAt: Date.now() + outcome.expiresIn * 1000,
        source: candidate.source,
      };
      return outcome.token;
    }
    lastFailure = outcome.failure;
    // Only retry the other source when this one was rejected as invalid_grant
    // (revoked/expired). 5xx / network errors won't be fixed by swapping tokens.
    if (!outcome.failure.invalidGrant) break;
  }

  // Every candidate failed — the admin proxy is dead until the operator
  // reconnects Google in-app (rewrites the DB refresh_token) or the env token
  // is refreshed. Keep the loud Sentry alert (runbook in
  // docs/GOOGLE_ADMIN_PROXY_SETUP.md). Google's error JSON carries no user PII,
  // and sentry-pii still scrubs token-shaped strings as defense in depth. We
  // throw only the clean reauth code — the raw Google body never leaves here.
  Sentry.captureMessage('google_admin_refresh_token_failed', {
    level: 'error',
    tags: { invalid_grant: lastFailure?.invalidGrant ?? false },
    extra: {
      email: env.GOOGLE_ADMIN_EMAIL,
      status: lastFailure?.status,
      body: lastFailure?.body,
      sources_tried: candidates.map((c) => c.source).join(','),
    },
  });
  throw new Error(ADMIN_REAUTH_ERROR);
}

// Test/diagnostics hook — clears the in-memory cache so the next call
// re-exchanges the refresh token. Production code never needs this.
export function __resetAdminTokenCache(): void {
  cached = null;
}
