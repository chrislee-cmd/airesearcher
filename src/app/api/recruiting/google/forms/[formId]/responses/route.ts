import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFormResponses } from '@/lib/google-forms';
import {
  filterConsentedRows,
  findConsentColumn,
} from '@/lib/recruiting/contact-filter';
import {
  formAccessErrorBody,
  resolveFormAccess,
} from '@/lib/recruiting/form-access';
import { maskPiiAnswers, piiQuestionIds } from '@/lib/recruiting-pii';

export const maxDuration = 60;

// Pulls the current responses for a single form. Caller proves
// ownership by being the user_id linked to the form row in
// recruiting_forms; we never let one user read another's responses.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId) return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });
  const url = new URL(req.url);
  const countOnly = url.searchParams.get('count_only') === '1';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Ownership + Google token routing (admin-proxy vs per-user OAuth) is
  // shared with the PII-unlock route so the two can never diverge.
  const access = await resolveFormAccess(formId, user.id);
  if (!access.ok) {
    return NextResponse.json(formAccessErrorBody(access), {
      status: access.status,
    });
  }

  try {
    const result = await getFormResponses(access.accessToken, formId);
    // Compliance gate: drop rows where the respondent did not consent
    // (or where the form lacks a consent column — legacy forms published
    // before the consent gate landed will return null here and pass
    // through unchanged so old data stays visible).
    const consentColumn = findConsentColumn(result.columns);
    const consentedRows = filterConsentedRows(result.rows, consentColumn);
    if (countOnly) {
      return NextResponse.json({
        count: consentedRows.length,
        total: result.rows.length,
      });
    }
    // Hide the consent column itself — every visible row is "동의합니다" by
    // construction so it carries no recruiter-useful signal.
    const visibleColumns = consentColumn
      ? result.columns.filter((c) => c.questionId !== consentColumn.questionId)
      : result.columns;
    // Privacy: PII columns (name / phone / email / address / birth / age) are
    // kept in the payload so the client can render a masked, left-aligned,
    // unlockable cell — but their *values* are blanked here. The real values
    // only ever leave the server through the credit-gated unlock route. This
    // replaces the old outright strip: the recruiter now sees that PII exists
    // (and can pay to reveal it) instead of the column silently vanishing.
    const piiQids = new Set(piiQuestionIds(visibleColumns));
    const consentQid = consentColumn?.questionId;
    const masked = maskPiiAnswers(consentedRows, piiQids).map((r) => {
      if (!consentQid) return r;
      const answers = { ...r.answers };
      delete answers[consentQid];
      return { ...r, answers };
    });
    return NextResponse.json({
      ...result,
      columns: visibleColumns,
      rows: masked,
      piiQuestionIds: [...piiQids],
      total: result.rows.length,
      consented: consentedRows.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
