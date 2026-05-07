import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { refreshAccessToken } from '@/lib/google-oauth';
import { createGoogleForm } from '@/lib/google-forms';
import { surveySchema, type Survey, type SurveyQuestion } from '@/lib/survey-schema';

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
  const { data: row } = await admin
    .from('user_google_oauth')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!row?.refresh_token) {
    return NextResponse.json({ error: 'google_not_connected' }, { status: 412 });
  }

  let accessToken: string;
  try {
    const { access_token } = await refreshAccessToken(row.refresh_token);
    accessToken = access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'refresh_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const survey = ensurePersonalSection(parsed.data.survey);

  try {
    const result = await createGoogleForm(accessToken, survey);
    // Persist so the responses panel can render across refreshes and
    // the auto-poll knows which forms to fetch for this user.
    await admin.from('recruiting_forms').upsert({
      form_id: result.formId,
      user_id: user.id,
      title: survey.title || '',
      responder_uri: result.responderUri,
      edit_uri: result.editUri,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'forms_create_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
