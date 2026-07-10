import { NextResponse } from 'next/server';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFormResponses } from '@/lib/google-forms';
import {
  filterConsentedRows,
  findConsentColumn,
} from '@/lib/recruiting/contact-filter';
import {
  formAccessErrorBody,
  resolveFormAccess,
} from '@/lib/recruiting/form-access';
import {
  ADMIN_REAUTH_ERROR,
  adminReauthErrorBody,
} from '@/lib/google-oauth-admin';
import type { RecruitingBrief } from '@/lib/recruiting-schema';
import {
  criteriaHash,
  deriveResponseKey,
  judgeRespondents,
  type ResponseJudgment,
} from '@/lib/recruiting/persona-fit';
import { setRecruitingFormStatus } from '@/lib/recruiting/form-status';

// Batch LLM calls (~20 respondents each) can run long on the first, cold judge
// of a large form. Cap at the plan max; incremental loads after that judge only
// the new rows so they stay well under.
export const maxDuration = 300;

type JudgmentRow = {
  response_key: string;
  judgment: ResponseJudgment;
  criteria_hash: string;
};

// GET the persona-fit judgments for one form. Ownership is proven by
// resolveFormAccess (same form_id → user_id check the responses route uses)
// before any responses are read; the judgment cache is then read/written with
// the service-role admin client (RLS-bypassing) since ownership is already
// established here.
//
// Cost control (spec pr-recruiting-persona-fit-judgment-backend):
//   * 캐시 — recruiting_response_judgments keyed by (form_id, response_key)
//   * 증분 — only response_keys missing from the cache (or judged against a
//     stale criteria_hash) are sent to the model
//   * criteria_hash — editing the form's 참여자 조건 changes the hash, so every
//     cached row goes stale and the whole form is re-judged
export async function GET(
  req: Request,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId } = await params;
  if (!formId) return NextResponse.json({ error: 'missing_form_id' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const access = await resolveFormAccess(formId, user.id);
  if (!access.ok) {
    const body =
      access.error === ADMIN_REAUTH_ERROR
        ? adminReauthErrorBody(user.email)
        : formAccessErrorBody(access);
    return NextResponse.json(body, { status: access.status });
  }

  const admin = createAdminClient();

  // Current 참여자 조건 for this form. Missing column (not-yet-migrated) or
  // absent criteria both degrade to demographics-only judging (fit = null).
  let criteria: RecruitingBrief['criteria'] | null = null;
  const critRes = await admin
    .from('recruiting_forms')
    .select('criteria')
    .eq('form_id', formId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!critRes.error && critRes.data) {
    criteria =
      (critRes.data as { criteria?: RecruitingBrief['criteria'] | null })
        .criteria ?? null;
  }
  const critHash = criteriaHash(criteria);

  // Pull responses (raw — PII values intact so the model can use them as
  // context; they are never echoed by the schema and never leave in the
  // returned payload). Consent gate mirrors the responses route.
  let columns;
  let consentedRows;
  try {
    const result = await getFormResponses(access.accessToken, formId);
    const consentColumn = findConsentColumn(result.columns);
    consentedRows = filterConsentedRows(result.rows, consentColumn);
    // Keep the consent column out of the judge input (every visible row is
    // "동의합니다" so it carries no signal), but retain PII columns for context.
    columns = consentColumn
      ? result.columns.filter((c) => c.questionId !== consentColumn.questionId)
      : result.columns;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'responses_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Load the existing cache for this form.
  const cacheRes = await admin
    .from('recruiting_response_judgments')
    .select('response_key, judgment, criteria_hash')
    .eq('form_id', formId);
  if (cacheRes.error) {
    console.error('judgments_cache_read_failed', cacheRes.error);
    return NextResponse.json({ error: cacheRes.error.message }, { status: 500 });
  }
  const cached = new Map<string, JudgmentRow>();
  for (const r of (cacheRes.data ?? []) as JudgmentRow[]) {
    cached.set(r.response_key, r);
  }

  // Incremental: a row needs (re)judging if it has no cached judgment, or the
  // cached one was produced against a now-stale criteria_hash.
  const toJudge = consentedRows.filter((row) => {
    const hit = cached.get(deriveResponseKey(row));
    return !hit || hit.criteria_hash !== critHash;
  });

  if (toJudge.length > 0) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
    }
    const anthropic = createAnthropic({ apiKey });
    // OBS-3 lifecycle FSM: this is the 추출(extraction) leg. Only flip status
    // when there's real work to do (new/stale rows) — an all-cached load leaves
    // the form's existing 'extracted' state untouched. Best-effort throughout;
    // a status write never blocks the judging the user is waiting on.
    await setRecruitingFormStatus(admin, formId, 'extracting');
    let fresh: ResponseJudgment[];
    try {
      fresh = await judgeRespondents(anthropic, criteria, columns, toJudge);
    } catch (e) {
      await setRecruitingFormStatus(admin, formId, 'error');
      const msg = e instanceof Error ? e.message : 'judge_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    if (fresh.length > 0) {
      const upsertRows = fresh.map((j) => ({
        form_id: formId,
        response_key: j.response_key,
        judgment: j,
        criteria_hash: critHash,
        judged_at: new Date().toISOString(),
      }));
      const up = await admin
        .from('recruiting_response_judgments')
        .upsert(upsertRows, { onConflict: 'form_id,response_key' });
      if (up.error) {
        // A cache-write failure shouldn't drop the judgments we just paid for;
        // log and still return them (next load re-judges the un-persisted rows).
        console.error('judgments_cache_write_failed', up.error);
      }
      for (const j of fresh) {
        cached.set(j.response_key, {
          response_key: j.response_key,
          judgment: j,
          criteria_hash: critHash,
        });
      }
    }
    // Extraction leg complete for this response set → 'extracted'.
    await setRecruitingFormStatus(admin, formId, 'extracted');
  }

  // Assemble the full judged list in response order. PII (name/phone) is never
  // included — the judgment payload only carries demographics + fit + flags.
  const judgments: ResponseJudgment[] = consentedRows.map((row) => {
    const key = deriveResponseKey(row);
    const hit = cached.get(key);
    if (hit) return hit.judgment;
    // Row we failed to judge (model dropped it) — return a null-fit stub so the
    // fullview can still render the row rather than silently omitting it.
    return {
      response_key: key,
      gender: null,
      age_group: null,
      region: null,
      fit: null,
      fit_reason: null,
      flags: [],
    };
  });

  return NextResponse.json({
    judgments,
    total: consentedRows.length,
    judged: toJudge.length,
    cached: consentedRows.length - toJudge.length,
  });
}
