// Active-org switcher endpoint — writes the `active_org` cookie (read back by
// getActiveOrg, src/lib/org.ts). Two entry points:
//
//   POST { org_id }        → profile-menu switcher (client fetch). Returns JSON.
//   GET  ?org_id=&next=    → invite-accept redirect (server-side). Sets the
//                            cookie on a redirect response, then bounces to
//                            `next` (an internal path). GET-with-cookie mirrors
//                            auth/callback/route.ts.
//
// Both re-validate membership against getCurrentUserOrgs before trusting the
// org_id — a non-member org_id never sets the cookie (403 / silent skip). This
// is the write-side half of the org-takeover guard (spec §제약 2); the cookie
// alone grants nothing, getActiveOrg re-checks on every read too.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE, getCurrentUserOrgs } from '@/lib/org';

export const runtime = 'nodejs';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

const Body = z.object({
  org_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_org_id' }, { status: 400 });
  }

  const orgs = await getCurrentUserOrgs();
  const isMember = orgs.some((o) => o.org_id === parsed.data.org_id);
  if (!isMember) {
    // Not a member (or membership not visible) — never set the cookie.
    return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, parsed.data.org_id, COOKIE_OPTIONS);
  return NextResponse.json({ ok: true, org_id: parsed.data.org_id });
}

// Sanitize an internal redirect target — only same-origin absolute paths are
// allowed (open-redirect guard). Anything else falls back to the app root.
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get('org_id');
  const next = safeNext(url.searchParams.get('next'));
  const dest = new URL(next, url.origin);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not signed in — just bounce to the target, no cookie.
    return NextResponse.redirect(dest);
  }

  const response = NextResponse.redirect(dest);

  if (orgId) {
    const orgs = await getCurrentUserOrgs();
    const isMember = orgs.some((o) => o.org_id === orgId);
    if (isMember) {
      response.cookies.set(ACTIVE_ORG_COOKIE, orgId, COOKIE_OPTIONS);
    }
    // Non-member org_id → skip silently, still redirect (fallback resolves org).
  }

  return response;
}
