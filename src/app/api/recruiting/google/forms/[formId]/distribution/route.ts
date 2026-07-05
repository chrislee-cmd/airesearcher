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
import { buildDistributionTable } from '@/lib/recruiting/distribution';

export const maxDuration = 60;

// Cross-tab distribution (성별 × 연령대 by default) for the recruiting
// fullview 분포 위젯. Shares ownership + Google-token routing + consent
// filtering with the responses route so the two can never diverge — only the
// *shape* differs: this endpoint returns aggregate pivot counts, never an
// individual respondent's answers, so there is no PII to mask.
//
// Query: x / y = questionId overrides for the gender / age axis columns
// (optional; axes are auto-detected by title when omitted — the default path
// the basic fullview uses).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId)
    return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });

  const url = new URL(req.url);
  const xQuestionId = url.searchParams.get('x') || undefined;
  const yQuestionId = url.searchParams.get('y') || undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const access = await resolveFormAccess(formId, user.id);
  if (!access.ok) {
    return NextResponse.json(formAccessErrorBody(access), {
      status: access.status,
    });
  }

  try {
    const result = await getFormResponses(access.accessToken, formId);
    // Same compliance gate as the responses route: only consented rows count.
    const consentColumn = findConsentColumn(result.columns);
    const consentedRows = filterConsentedRows(result.rows, consentColumn);

    const table = buildDistributionTable(result.columns, consentedRows, {
      nowYear: new Date().getFullYear(),
      xQuestionId,
      yQuestionId,
    });

    // table === null → form has no gender/age column; the client renders a
    // "문항 없음" empty state (distinct from grandTotal 0 = no responses yet).
    return NextResponse.json({ table });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'distribution_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
