import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { CONSENT_VERSION, type ConsentType } from '@/lib/consent';

// Records consent grants/revocations for the authenticated user.
//
// Two callers today:
//   - Email/password signup form: posts the required + optional consents
//     immediately after a successful signUp.
//   - Cookie consent banner: posts the user's analytics/marketing choice
//     once they accept (or reject) the banner.
//
// The route gates on the Supabase session cookie — anonymous users
// (banner shown pre-login) must not write here; the banner stores their
// choice in localStorage instead and syncs on next sign-in.

const ALLOWED_TYPES: ReadonlySet<ConsentType> = new Set([
  'privacy_policy',
  'terms_of_service',
  'marketing',
  'analytics',
  'llm_processing',
]);

type Body = {
  consents: Array<{
    type: ConsentType;
    granted: boolean;
    metadata?: Record<string, unknown>;
  }>;
  source?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!Array.isArray(body.consents) || body.consents.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const rows = body.consents
    .filter((c) => ALLOWED_TYPES.has(c.type))
    .map((c) => ({
      user_id: user.id,
      consent_type: c.type,
      granted: Boolean(c.granted),
      version: CONSENT_VERSION,
      granted_at: new Date().toISOString(),
      revoked_at: c.granted ? null : new Date().toISOString(),
      metadata: {
        source: body.source ?? 'unspecified',
        ...(c.metadata ?? {}),
      },
    }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { error } = await supabase.from('user_consents').insert(rows);
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  for (const row of rows) {
    await logAudit({
      event_type: row.granted ? 'consent_granted' : 'consent_revoked',
      user_id: user.id,
      actor_email: user.email ?? null,
      resource_type: 'user_consent',
      metadata: {
        consent_type: row.consent_type,
        version: row.version,
        source: body.source ?? 'unspecified',
      },
      request,
    });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
