import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken, hasResponsesScope } from '@/lib/google-oauth';
import {
  getAdminAccessToken,
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';

// Resolves a Google API access token for reading a recruiting form's
// responses, proving that `userId` owns the form first. Extracted so the
// responses route and the fullview PII-unlock route share one ownership +
// token-routing path — they must never diverge (a looser check in one would
// let a user read or de-anonymise another user's responses).
export type FormAccess =
  | { ok: true; accessToken: string }
  | { ok: false; status: number; error: string };

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
  const useAdminToken =
    isAdminProxyConfigured() &&
    ownerEmail !== null &&
    adminEmail !== null &&
    ownerEmail === adminEmail;

  if (useAdminToken) {
    try {
      return { ok: true, accessToken: await getAdminAccessToken() };
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'admin_token_refresh_failed';
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
    const msg = e instanceof Error ? e.message : 'refresh_failed';
    return { ok: false, status: 502, error: msg };
  }
}
