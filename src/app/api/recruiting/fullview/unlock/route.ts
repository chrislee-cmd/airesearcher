import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { spendCredits, getOrgCredits } from '@/lib/credits';
import { getFormResponses } from '@/lib/google-forms';
import {
  filterConsentedRows,
  findConsentColumn,
} from '@/lib/recruiting/contact-filter';
import { resolveFormAccess } from '@/lib/recruiting/form-access';
import { extractPiiAnswers, piiQuestionIds } from '@/lib/recruiting-pii';
import { FEATURE_COSTS } from '@/lib/features';

export const maxDuration = 60;

// POST /api/recruiting/fullview/unlock
// Credit-gated reveal of one respondent's PII cells in the recruiting
// fullview spreadsheet. Charges a flat 5 credits (server-authoritative — the
// client-sent cost, if any, is ignored) and only then returns the real PII
// values for that row. The responses route never ships raw PII, so this
// endpoint is the sole path by which personal info leaves the server — the
// charge cannot be bypassed from the browser.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    formId?: string;
    rowId?: string;
  };
  const formId = typeof body.formId === 'string' ? body.formId : '';
  const rowId = typeof body.rowId === 'string' ? body.rowId : '';
  if (!formId || !rowId) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  // Same ownership + token routing as the responses route.
  const access = await resolveFormAccess(formId, user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Fetch first so we can validate the row exists (and is a consented row)
  // and extract its PII *before* charging — a bad rowId costs nothing.
  let answers: Record<string, string>;
  try {
    const result = await getFormResponses(access.accessToken, formId);
    const consentColumn = findConsentColumn(result.columns);
    const consentedRows = filterConsentedRows(result.rows, consentColumn);
    const row = consentedRows.find((r) => r.responseId === rowId);
    if (!row) {
      return NextResponse.json({ error: 'row_not_found' }, { status: 404 });
    }
    const piiQids = new Set(piiQuestionIds(result.columns));
    answers = extractPiiAnswers(row, piiQids);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Charge. generationId is left null — each unlock is an independent charge
  // (no generations row), and the session-scoped client model intentionally
  // re-charges on re-unlock after a tab close.
  const spend = await spendCredits(org.org_id, 'recruiting_pii_unlock');
  if (!spend.ok) {
    const status = spend.reason === 'insufficient' ? 402 : 403;
    return NextResponse.json({ error: spend.reason }, { status });
  }

  // Best-effort audit/billing log via the service-role client (RLS has no
  // insert policy). The credit_transactions ledger is the authoritative
  // billing record, so a log failure must not block the paid reveal.
  try {
    const admin = createAdminClient();
    await admin.from('recruiting_pii_unlocks').insert({
      user_id: user.id,
      org_id: org.org_id,
      form_id: formId,
      row_id: rowId,
      cost: FEATURE_COSTS.recruiting_pii_unlock,
    });
  } catch {
    // swallow — charge already succeeded; ledger row stands.
  }

  const remaining = await getOrgCredits(org.org_id);
  return NextResponse.json({ ok: true, remaining_credits: remaining, answers });
}
