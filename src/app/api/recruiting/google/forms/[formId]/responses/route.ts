import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFormResponses } from '@/lib/google-forms';
import { visibleFormResponses } from '@/lib/recruiting/form-responses';
import {
  formAccessErrorBody,
  resolveFormAccess,
} from '@/lib/recruiting/form-access';
import {
  ADMIN_REAUTH_ERROR,
  adminReauthErrorBody,
} from '@/lib/google-oauth-admin';

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
    // Admin-proxy token exhausted → friendly reauth payload (CTA only for the
    // operator). All other failures keep the shared per-user error body.
    const body =
      access.error === ADMIN_REAUTH_ERROR
        ? adminReauthErrorBody(user.email)
        : formAccessErrorBody(access);
    return NextResponse.json(body, { status: access.status });
  }

  try {
    const result = await getFormResponses(access.accessToken, formId);
    // 정제(동의 게이트 + consent 컬럼 숨김 + PII 값 blank)는 위젯 CSV 렌더러와
    // 공유하는 visibleFormResponses 로 단일화 — 뷰와 export 가 divergence 하지
    // 않는다(legacy 폼은 consent 컬럼이 없어 전체 통과).
    const visible = visibleFormResponses(result);
    if (countOnly) {
      return NextResponse.json({
        count: visible.consented,
        total: visible.total,
      });
    }
    return NextResponse.json({
      ...result,
      columns: visible.columns,
      rows: visible.rows,
      piiQuestionIds: visible.piiQuestionIds,
      total: visible.total,
      consented: visible.consented,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
