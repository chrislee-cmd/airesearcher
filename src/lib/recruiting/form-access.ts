import { createAdminClient } from '@/lib/supabase/admin';
import {
  GoogleInvalidGrantError,
  refreshAccessToken,
  hasResponsesScope,
} from '@/lib/google-oauth';
import {
  ADMIN_REAUTH_ERROR,
  getAdminAccessToken,
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';

// Resolves a Google API access token for reading a recruiting form's
// responses, proving that `userId` owns the form first. Extracted as a shared
// ownership + token-routing path so any current or future reader of a form's
// responses enforces the same check — a looser check would let a user read
// another user's responses.
export type FormAccess =
  | { ok: true; accessToken: string }
  | { ok: false; status: number; error: string; reauthUrl?: string };

// Where the client should send the user to redo the Google OAuth consent
// flow. Reuses the existing start route (callback already overwrites the
// stored refresh_token) — no new endpoint.
export const GOOGLE_REAUTH_URL = '/api/recruiting/google/start';

// JSON body for a failed FormAccess — shared by every route that answers
// with `resolveFormAccess` failures so the reauth payload shape
// (`error` + `reauth_url` + human message) can never diverge between them.
export function formAccessErrorBody(
  access: Extract<FormAccess, { ok: false }>,
): Record<string, string> {
  if (access.error === 'google_reauth_required') {
    return {
      error: access.error,
      message: 'Google 재연결이 필요합니다',
      reauth_url: access.reauthUrl ?? GOOGLE_REAUTH_URL,
    };
  }
  return { error: access.error };
}

export async function resolveFormAccess(
  formId: string,
  userId: string,
): Promise<FormAccess> {
  const admin = createAdminClient();

  // Prove ownership and read owner_email (the token-routing key) in one
  // shot. owner_email may be absent in older environments (schema-cache
  // PGRST204 / column-missing 42703) — fall back to the narrow ownership
  // lookup so the page doesn't 500.
  let ownerEmail: string | null = null;
  let ownershipFound = false;
  const wide = await admin
    .from('recruiting_forms')
    .select('form_id, owner_email')
    .eq('form_id', formId)
    .eq('user_id', userId)
    .maybeSingle();
  if (wide.data) {
    ownershipFound = true;
    ownerEmail =
      (wide.data as { owner_email?: string | null }).owner_email ?? null;
  } else if (wide.error) {
    const code = wide.error.code;
    const msg = wide.error.message ?? '';
    const isMissingOwnerEmail =
      code === '42703' || (code === 'PGRST204' && /owner_email/.test(msg));
    if (!isMissingOwnerEmail) {
      return { ok: false, status: 500, error: msg };
    }
    const narrow = await admin
      .from('recruiting_forms')
      .select('form_id')
      .eq('form_id', formId)
      .eq('user_id', userId)
      .maybeSingle();
    ownershipFound = !!narrow.data;
  }
  if (!ownershipFound) {
    return { ok: false, status: 403, error: 'not_owner' };
  }

  // owner_email === configured admin email → form lives in the admin Drive,
  // fetch with the admin token. Legacy rows (owner_email null) were published
  // by the requesting user's own OAuth — use their per-user token.
  const adminEmail = getAdminEmail();
  const proxyOn = await isAdminProxyConfigured();
  const useAdminToken =
    proxyOn &&
    ownerEmail !== null &&
    adminEmail !== null &&
    ownerEmail === adminEmail;

  if (useAdminToken) {
    try {
      return { ok: true, accessToken: await getAdminAccessToken() };
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'admin_token_refresh_failed';
      // Both admin token sources (DB + env) failed. Return a clean 503 reauth
      // code — the calling route turns this into the friendly operator-reconnect
      // payload (adminReauthErrorBody) so no raw Google error reaches the client.
      if (msg === ADMIN_REAUTH_ERROR) {
        return { ok: false, status: 503, error: ADMIN_REAUTH_ERROR };
      }
      return { ok: false, status: 502, error: msg };
    }
  }

  const { data: oauth } = await admin
    .from('user_google_oauth')
    .select('refresh_token,scope')
    .eq('user_id', userId)
    .maybeSingle();
  if (!oauth?.refresh_token) {
    return { ok: false, status: 412, error: 'google_not_connected' };
  }
  if (!hasResponsesScope(oauth.scope)) {
    return { ok: false, status: 412, error: 'reconsent_required' };
  }
  try {
    const { access_token } = await refreshAccessToken(oauth.refresh_token);
    return { ok: true, accessToken: access_token };
  } catch (e) {
    // Revoked/expired refresh_token — only the user can fix this, by
    // reconnecting Google. 401 + explicit code lets the client render a
    // reconnect CTA instead of the old opaque 502.
    if (e instanceof GoogleInvalidGrantError) {
      return {
        ok: false,
        status: 401,
        error: 'google_reauth_required',
        reauthUrl: GOOGLE_REAUTH_URL,
      };
    }
    const msg = e instanceof Error ? e.message : 'refresh_failed';
    return { ok: false, status: 502, error: msg };
  }
}
