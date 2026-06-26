import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import {
  CONSENT_VERSION,
  OAUTH_CONSENT_COOKIE,
  type ConsentType,
} from '@/lib/consent';
import { routing } from '@/i18n/routing';
import { validateNext } from '@/lib/auth/validate-next';

type OauthConsentPayload = {
  version?: string;
  privacy?: boolean;
  terms?: boolean;
  marketing?: boolean;
};

function parseOauthConsent(raw: string | undefined): OauthConsentPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as OauthConsentPayload;
  } catch {
    return null;
  }
}

// Returns the consent types that already have a granted row at the
// current version for this user. Used to avoid duplicate inserts when
// an existing user signs in again with Google.
async function existingCurrentConsents(userId: string): Promise<Set<ConsentType>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('user_consents')
    .select('consent_type')
    .eq('user_id', userId)
    .eq('version', CONSENT_VERSION)
    .eq('granted', true);
  return new Set((data ?? []).map((r) => r.consent_type as ConsentType));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const explicitNext = validateNext(url.searchParams.get('next'));

  let locale: string = routing.defaultLocale;

  if (code) {
    const supabase = await createClient();
    const { data: session, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      await logAudit({
        event_type: 'login_failure',
        metadata: { method: 'oauth', reason: exchangeError.message },
        request,
      });
    }

    // Logged-in user: their saved profile.locale wins over Accept-Language.
    if (session?.user) {
      // Single-session enforcement: revoke other active sessions, fire-
      // and-forget. Awaiting this was racing with the just-exchanged
      // session's cookies and stripping them from the redirect response,
      // leaving the user 401'd on every API call (see the matching
      // change in email-password-form.tsx for the same root cause).
      void supabase.auth.signOut({ scope: 'others' }).catch(() => {});

      const userId = session.user.id;
      const userEmail = session.user.email ?? null;

      // Persist OAuth signup consents (if cookie was stamped before the
      // round-trip and the user doesn't already have current-version
      // consents on record). Best-effort — failures must not break login.
      const cookieStore = await cookies();
      const consentCookie = cookieStore.get(OAUTH_CONSENT_COOKIE)?.value;
      const consent = parseOauthConsent(consentCookie);
      if (consent && consent.version === CONSENT_VERSION) {
        try {
          const already = await existingCurrentConsents(userId);
          const rows: Array<{
            user_id: string;
            consent_type: ConsentType;
            granted: boolean;
            version: string;
            metadata: Record<string, unknown>;
            granted_at: string;
            revoked_at: string | null;
          }> = [];
          const nowIso = new Date().toISOString();
          if (consent.privacy && !already.has('privacy_policy')) {
            rows.push({
              user_id: userId,
              consent_type: 'privacy_policy',
              granted: true,
              version: CONSENT_VERSION,
              granted_at: nowIso,
              revoked_at: null,
              metadata: { source: 'signup_oauth_google' },
            });
          }
          if (consent.terms && !already.has('terms_of_service')) {
            rows.push({
              user_id: userId,
              consent_type: 'terms_of_service',
              granted: true,
              version: CONSENT_VERSION,
              granted_at: nowIso,
              revoked_at: null,
              metadata: { source: 'signup_oauth_google' },
            });
          }
          if (
            typeof consent.marketing === 'boolean' &&
            !already.has('marketing')
          ) {
            rows.push({
              user_id: userId,
              consent_type: 'marketing',
              granted: consent.marketing,
              version: CONSENT_VERSION,
              granted_at: nowIso,
              revoked_at: consent.marketing ? null : nowIso,
              metadata: { source: 'signup_oauth_google' },
            });
          }
          if (rows.length > 0) {
            const admin = createAdminClient();
            const { error: insertError } = await admin
              .from('user_consents')
              .insert(rows);
            if (insertError) {
              console.error('[auth/callback] consent insert failed', insertError);
            } else {
              for (const row of rows) {
                await logAudit({
                  event_type: row.granted ? 'consent_granted' : 'consent_revoked',
                  user_id: userId,
                  actor_email: userEmail,
                  resource_type: 'user_consent',
                  metadata: {
                    consent_type: row.consent_type,
                    version: row.version,
                    source: 'signup_oauth_google',
                  },
                  request,
                });
              }
            }
          }
        } catch (err) {
          console.error('[auth/callback] consent persistence threw', err);
        }
      }

      await logAudit({
        event_type: 'login_success',
        user_id: userId,
        actor_email: userEmail,
        metadata: { method: 'oauth' },
        request,
      });

      const { data: profile } = await supabase
        .from('profiles')
        .select('locale')
        .eq('id', userId)
        .maybeSingle();
      const candidate = profile?.locale;
      if (
        candidate &&
        (routing.locales as readonly string[]).includes(candidate)
      ) {
        locale = candidate;
      }
    }
  }

  const target = explicitNext ?? `/${locale}/canvas`;
  const response = NextResponse.redirect(new URL(target, url.origin));
  // Persist for next-intl middleware so subsequent visits skip
  // Accept-Language detection and respect the user's saved preference.
  response.cookies.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  // Clear the OAuth consent cookie once consumed — either inserted above
  // or stale from an abandoned round-trip.
  response.cookies.set(OAUTH_CONSENT_COOKIE, '', {
    path: '/',
    maxAge: 0,
    sameSite: 'lax',
  });
  return response;
}
