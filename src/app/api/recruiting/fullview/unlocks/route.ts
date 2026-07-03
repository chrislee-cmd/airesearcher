import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';

export const dynamic = 'force-dynamic';

// GET /api/recruiting/fullview/unlocks?formId=<id>
// Returns the row ids already PII-unlocked (and thus already paid) for a form
// within the caller's active org. The fullview spreadsheet hydrates its
// in-memory unlock state from this on load so that a tab close / refresh does
// not re-lock — and therefore never re-charges — rows the org already paid to
// reveal. No PII values are returned here (that stays behind the credit-gated
// POST /unlock); only the identifiers of already-unlocked rows.
export async function GET(req: Request) {
  const formId = new URL(req.url).searchParams.get('formId') ?? '';
  if (!formId) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  // Org-scoped: unlocks belong to an org, and the caller is a member of the
  // active org, so filtering by (org_id, form_id) never leaks another org's
  // unlock list. No Google token / ownership round-trip needed — this returns
  // only row ids and must keep working even if the Google link later expires.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('recruiting_pii_unlocks')
    .select('row_id')
    .eq('org_id', org.org_id)
    .eq('form_id', formId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const unlockedRowIds = Array.from(
    new Set((data ?? []).map((r) => (r as { row_id: string }).row_id)),
  );
  return NextResponse.json({ unlockedRowIds });
}
