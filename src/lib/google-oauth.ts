// Tiny helpers for the Google OAuth + Forms publish flow used by the
// recruiting feature. We intentionally avoid pulling in `googleapis` —
// only need authorize URL, code → token exchange, refresh, and a single
// `forms.create` + `batchUpdate` call.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// forms.body is the minimum scope to create + edit a form via the API.
// forms.responses.readonly lets the recruiting page sync responses back
// from the published form. userinfo.email is captured so we can show
// the user which Google account is connected without an extra round-
// trip later.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

// Existing connected users have an older `scope` string lacking this
// entry; the UI checks via `hasResponsesScope` and prompts to reconnect
// rather than letting response fetches silently 403.
export const RESPONSES_SCOPE =
  'https://www.googleapis.com/auth/forms.responses.readonly';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export function hasResponsesScope(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return stored.split(/\s+/).includes(RESPONSES_SCOPE);
}

export function hasDriveFileScope(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return stored.split(/\s+/).includes(DRIVE_FILE_SCOPE);
}

export function getGoogleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('missing_google_oauth_env');
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    // `consent` makes Google reissue a refresh_token even if the user has
    // previously authorized this app — without it, repeat connects often
    // omit the refresh_token and we lose the ability to publish later.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGoogleEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`google_token_exchange_failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = getGoogleEnv();
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
    throw new Error(`google_token_refresh_failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

export function decodeIdTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}
