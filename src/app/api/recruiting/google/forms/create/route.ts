import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { refreshAccessToken, hasSheetsScope } from '@/lib/google-oauth';
import {
  getAdminAccessToken,
  getAdminEmail,
  isAdminProxyConfigured,
} from '@/lib/google-oauth-admin';
import { createGoogleForm } from '@/lib/google-forms';
import { createGoogleSheet } from '@/lib/share/google-sheets';
import { surveySchema, type Survey, type SurveyQuestion } from '@/lib/survey-schema';
import {
  ensureMandatoryPhoneNotice,
  ensurePrivacyConsent,
} from '@/lib/recruiting/survey-postprocess';

export const maxDuration = 60;

const Body = z.object({ survey: surveySchema });

const PERSONAL_SECTION_TITLE = '인적사항';

function makeQuestion(
  partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, 'kind' | 'title'>,
): SurveyQuestion {
  return {
    kind: partial.kind,
    title: partial.title,
    description: partial.description ?? '',
    required: partial.required ?? true,
    options: partial.options ?? [],
    scaleMin: partial.scaleMin ?? 0,
    scaleMax: partial.scaleMax ?? 0,
    scaleMinLabel: partial.scaleMinLabel ?? '',
    scaleMaxLabel: partial.scaleMaxLabel ?? '',
  };
}

const PERSONAL_QUESTIONS: SurveyQuestion[] = [
  makeQuestion({ kind: 'short_answer', title: '이름' }),
  makeQuestion({ kind: 'short_answer', title: '출생년도 (4자리)', description: '예: 1990' }),
  makeQuestion({
    kind: 'single_choice',
    title: '성별',
    options: ['여성', '남성', '응답하지 않음'],
  }),
  makeQuestion({
    kind: 'single_choice',
    title: '사용 중인 핸드폰 브랜드',
    options: ['삼성', '애플', '기타'],
  }),
  makeQuestion({
    kind: 'short_answer',
    title: '핸드폰 기기 모델명',
    description: '예: 아이폰 16, 갤럭시 S21',
  }),
  makeQuestion({
    kind: 'long_answer',
    title:
      '만약 본인에게 자유롭게 사용할 수 있는 돈 100만원이 생긴다면, 어떻게 그 돈을 사용하고 싶으신가요? 저축은 할 수 없고 반드시 소비를 하셔야 합니다.',
  }),
];

function normalizeTitle(s: string) {
  return s.replace(/\s+/g, '').toLowerCase();
}

function ensurePersonalSection(survey: Survey): Survey {
  const sections = [...survey.sections];
  const lastIdx = sections.length - 1;
  const last = lastIdx >= 0 ? sections[lastIdx] : null;
  const isPersonal = !!last && last.title.includes(PERSONAL_SECTION_TITLE);
  if (isPersonal) {
    const have = new Set(last.questions.map((q) => normalizeTitle(q.title)));
    const missing = PERSONAL_QUESTIONS.filter((q) => !have.has(normalizeTitle(q.title)));
    if (missing.length === 0) return survey;
    sections[lastIdx] = { ...last, questions: [...last.questions, ...missing] };
    return { ...survey, sections };
  }
  sections.push({ title: PERSONAL_SECTION_TITLE, questions: PERSONAL_QUESTIONS });
  return { ...survey, sections };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Admin-proxy mode: every publish lands in GOOGLE_ADMIN_EMAIL's Drive
  // regardless of who clicked "발행". The user never needs to OAuth.
  // When the admin env is unset (local dev, untouched preview) we fall
  // through to the legacy per-user OAuth path so old worktrees keep
  // working without an env migration.
  const adminProxy = isAdminProxyConfigured();

  let accessToken: string;
  let ownerEmail: string | null = null;
  // Sheets scope is implicit for the admin (consent granted up-front
  // when the refresh token was minted with full SHARE_SCOPES). For the
  // legacy per-user path we still gate on the stored scope string.
  let canCreateSheet = false;

  if (adminProxy) {
    try {
      accessToken = await getAdminAccessToken();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'admin_token_refresh_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    ownerEmail = getAdminEmail();
    canCreateSheet = true;
  } else {
    const { data: row } = await admin
      .from('user_google_oauth')
      .select('refresh_token, scope')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!row?.refresh_token) {
      return NextResponse.json(
        { error: 'google_not_connected' },
        { status: 412 },
      );
    }
    try {
      const { access_token } = await refreshAccessToken(row.refresh_token);
      accessToken = access_token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'refresh_failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    canCreateSheet = hasSheetsScope(row.scope);
  }

  // ensureMandatoryPhoneNotice + ensurePrivacyConsent are idempotent —
  // the wizard runs both on the streamed survey too, but we re-apply
  // here so any caller (or any future surface that calls /create
  // directly) cannot publish a form without the contact-phone notice
  // and the privacy-consent gate the recruiting flow promises.
  const survey = ensurePrivacyConsent(
    ensureMandatoryPhoneNotice(ensurePersonalSection(parsed.data.survey)),
  );

  try {
    const result = await createGoogleForm(accessToken, survey);
    // Best-effort: create a companion Google Sheet seeded with the
    // form's question titles as headers when the user has the Sheets
    // scope. The Google Forms API does not expose a way to attach an
    // existing Sheet as the form's response destination, so this Sheet
    // is a standalone artifact — recruiting flows still rely on the
    // Forms responses API for the live data, but the widget surfaces
    // this URL as a one-click "응답 시트" CTA. Failures are swallowed:
    // the form is published either way, and the widget shows the
    // "시트 연결" fallback button when sheet_url stays null.
    let sheetUrl: string | null = null;
    let sheetId: string | null = null;
    if (canCreateSheet) {
      try {
        const headers = sheetHeaders(survey);
        const sheet = await createGoogleSheet(
          accessToken,
          `${survey.title || '리서치 설문'} — 응답`,
          [headers],
        );
        sheetUrl = sheet.url;
        sheetId = sheet.spreadsheetId;
      } catch {
        // ignore — keep null and let the UI offer "시트 연결" later
      }
    }
    // Stamp org_id at creation so the dashboard's recruiting count
    // attributes new forms to the user's active org. Older rows can
    // remain null — they show up under "unfiled" until backfilled.
    // getActiveOrg() reads cookies + DB; a transient failure here used
    // to bubble up and trash a successful Google publish, so we tolerate
    // it and persist with org_id=null.
    let activeOrgId: string | null = null;
    try {
      const org = await getActiveOrg();
      activeOrgId = org?.org_id ?? null;
    } catch (orgErr) {
      console.error('forms_create_active_org_failed', orgErr);
    }
    // Two-stage persist: prefer the full row (with sheet_url/sheet_id
    // from migration 20260624032912). When those columns aren't yet
    // applied in this environment, Postgres throws 42703; we fall back
    // to the legacy column set so the published form still lands in
    // recruiting_forms and shows up in the list. Without this fallback
    // the Google Form would be created but invisible to the widget,
    // which the user sees as a stuck "발행중" round-trip.
    const baseRow = {
      form_id: result.formId,
      user_id: user.id,
      org_id: activeOrgId,
      title: survey.title || '',
      responder_uri: result.responderUri,
      edit_uri: result.editUri,
    };
    const fullRow = {
      ...baseRow,
      sheet_url: sheetUrl,
      sheet_id: sheetId,
      owner_email: ownerEmail,
    };
    const upsert = await admin.from('recruiting_forms').upsert(fullRow);
    if (upsert.error) {
      // Postgres native column-not-found is 42703, but supabase-js routes
      // through PostgREST which catches it at the schema-cache layer and
      // surfaces PGRST204 with a "Could not find the 'X' column" message
      // (observed in prod when migration 20260624032912 hadn't landed).
      // Match either code, narrowed to the new columns by message so we
      // don't swallow unrelated PGRST204s. owner_email is the freshest
      // addition (this PR's migration) — preview envs may publish before
      // db push lands, so retry without it as well.
      const errMsg = upsert.error.message ?? '';
      const code = upsert.error.code;
      const isMissingOwnerEmail =
        code === '42703' ||
        (code === 'PGRST204' && /owner_email/.test(errMsg));
      const isMissingSheetColumn =
        code === '42703' ||
        (code === 'PGRST204' && /sheet_(url|id)/.test(errMsg));
      if (isMissingOwnerEmail && !isMissingSheetColumn) {
        const { owner_email: _omit, ...withoutOwnerEmail } = fullRow;
        void _omit;
        const retry = await admin
          .from('recruiting_forms')
          .upsert(withoutOwnerEmail);
        if (retry.error) {
          console.error('forms_create_persist_failed', retry.error);
        }
      } else if (isMissingSheetColumn) {
        const retry = await admin.from('recruiting_forms').upsert(baseRow);
        if (retry.error) {
          console.error('forms_create_persist_failed', retry.error);
        }
      } else {
        console.error('forms_create_persist_failed', upsert.error);
      }
    }
    return NextResponse.json({ ...result, sheetUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'forms_create_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Flatten the survey's questions in form order, mirroring the column
// order the Forms response API returns. Section titles are dropped
// because the responses sheet only needs question columns.
function sheetHeaders(survey: Survey): string[] {
  const headers = ['응답시각'];
  for (const section of survey.sections) {
    for (const q of section.questions) {
      headers.push(q.title);
    }
  }
  return headers;
}
