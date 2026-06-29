import type { Survey, SurveyQuestion } from '@/lib/survey-schema';

// Mandatory phone-contact notice required on every survey we publish.
// The LLM that generates the survey is constrained but not perfect, so we
// enforce this post-process step (idempotent) on the client + the publish
// route as a defense-in-depth check.
export const MANDATORY_PHONE_NOTICE =
  '인터뷰 대상자로 선정되셨을 때 연락을 드릴 수 있도록 전화번호를 정확히 적어주세요';

// 개인정보 보호법 §15 — 정보주체 동의 없이 개인정보 수집 불가. 모든
// 스크리닝 설문은 응답자가 명시적으로 동의해야 진행할 수 있도록 첫
// 섹션에 동의 질문을 자동 삽입한다. LLM 프롬프트도 동의 항목을
// 권장하지만, 누락 시 post-process 가 보장한다 (idempotent).
export const PRIVACY_CONSENT_SECTION_TITLE = '개인정보 수집 동의';
export const PRIVACY_CONSENT_TITLE = '개인정보 수집 및 이용 동의';
export const PRIVACY_CONSENT_AGREE = '동의합니다';
export const PRIVACY_CONSENT_DENY = '동의하지 않습니다';
export const PRIVACY_CONSENT_DESCRIPTION = [
  '[수집 항목]',
  '- 응답자가 입력한 모든 응답 내용',
  '- 이름, 출생년도, 성별',
  '- 연락처 (전화번호)',
  '- 사용 기기 정보 (핸드폰 브랜드 / 모델명)',
  '',
  '[수집 목적]',
  '- 인터뷰 대상자 선정 심사',
  '- 선정된 응답자에게 인터뷰 일정 안내 및 연락',
  '- 인터뷰 결과 데이터의 익명화 분석',
  '',
  '[보유 기간]',
  '- 선정 대상자: 인터뷰 종료 후 30일 보관 후 자동 폐기',
  '- 미선정 대상자: 심사 완료 후 7일 보관 후 자동 폐기',
  '',
  '[동의 거부 권리]',
  '- 동의를 거부하실 권리가 있으며, 거부 시 인터뷰 참여가 불가합니다.',
  '- 동의 후에도 언제든지 요청을 통해 데이터 삭제가 가능합니다.',
].join('\n');

// Match the contact-phone question explicitly — '핸드폰 브랜드' / '핸드폰
// 기기 모델명' are device questions and must NOT match. We key on a
// composite signal (전화번호 / 연락처 / phone number / mobile number) to
// avoid the model-name false positive.
const PHONE_QUESTION_RE = /전화\s*번호|연락처|phone\s*number|mobile\s*number/i;

export function isPhoneContactQuestion(q: SurveyQuestion): boolean {
  return (
    PHONE_QUESTION_RE.test(q.title) ||
    PHONE_QUESTION_RE.test(q.description ?? '')
  );
}

function withNoticeDescription(desc: string | undefined | null): string {
  const current = (desc ?? '').trim();
  if (current.includes(MANDATORY_PHONE_NOTICE)) return current;
  return current
    ? `${current}\n\n${MANDATORY_PHONE_NOTICE}`
    : MANDATORY_PHONE_NOTICE;
}

function makePhoneQuestion(): SurveyQuestion {
  return {
    kind: 'short_answer',
    title: '연락 가능한 전화번호',
    description: MANDATORY_PHONE_NOTICE,
    required: true,
    options: [],
    scaleMin: 0,
    scaleMax: 0,
    scaleMinLabel: '',
    scaleMaxLabel: '',
  };
}

// Idempotent: guarantees the published survey carries a contact-phone
// question whose description includes MANDATORY_PHONE_NOTICE. If one
// already exists (anywhere in the survey) we only patch its description;
// otherwise we insert a new question into the last section, just before
// the standard "100만원" long-answer prompt when present, else at end.
export function ensureMandatoryPhoneNotice(survey: Survey): Survey {
  const sections = survey.sections.map((s) => ({
    ...s,
    questions: [...s.questions],
  }));

  let patched = false;
  for (const section of sections) {
    for (let i = 0; i < section.questions.length; i++) {
      const q = section.questions[i];
      if (isPhoneContactQuestion(q)) {
        section.questions[i] = {
          ...q,
          description: withNoticeDescription(q.description),
        };
        patched = true;
      }
    }
  }
  if (patched) return { ...survey, sections };

  if (sections.length === 0) {
    return {
      ...survey,
      sections: [{ title: '인적사항', questions: [makePhoneQuestion()] }],
    };
  }

  const last = sections[sections.length - 1];
  const beforeIdx = last.questions.findIndex(
    (q) => q.kind === 'long_answer' && q.title.includes('100만원'),
  );
  const insertAt = beforeIdx >= 0 ? beforeIdx : last.questions.length;
  last.questions.splice(insertAt, 0, makePhoneQuestion());
  return { ...survey, sections };
}

// Match a privacy-consent question by title. Both "개인정보" and "동의"
// must appear so we don't false-match "동의 및 일정" (참여 가능 일정
// 동의) — which is a scheduling question, not a privacy consent.
export function isPrivacyConsentQuestion(q: SurveyQuestion): boolean {
  const t = q.title.toLowerCase();
  if (/privacy.{0,5}consent/.test(t)) return true;
  return t.includes('개인정보') && t.includes('동의');
}

function makePrivacyConsentQuestion(): SurveyQuestion {
  return {
    kind: 'single_choice',
    title: PRIVACY_CONSENT_TITLE,
    description: PRIVACY_CONSENT_DESCRIPTION,
    required: true,
    options: [PRIVACY_CONSENT_AGREE, PRIVACY_CONSENT_DENY],
    scaleMin: 0,
    scaleMax: 0,
    scaleMinLabel: '',
    scaleMaxLabel: '',
  };
}

// Idempotent: guarantees the published survey carries a privacy-consent
// question. If the LLM already produced one (anywhere in the survey) we
// normalise it in place — title / description / kind / options / required
// all get clamped to the canonical values so legal review only ever sees
// one phrasing. If none exists we insert a brand-new section at index 0
// so the consent gate is the very first thing a respondent sees.
//
// Why a dedicated section instead of unshifting into section 0: the LLM
// orders section 0 as "기본 정보" (demographic screeners) and prepending a
// consent question there confuses the respondent's mental model. A
// separate section also lets Google Forms render the description block
// at section level — a much cleaner reading experience than a giant
// question description.
export function ensurePrivacyConsent(survey: Survey): Survey {
  const sections = survey.sections.map((s) => ({
    ...s,
    questions: [...s.questions],
  }));

  for (const section of sections) {
    for (let i = 0; i < section.questions.length; i++) {
      const q = section.questions[i];
      if (isPrivacyConsentQuestion(q)) {
        section.questions[i] = makePrivacyConsentQuestion();
        return { ...survey, sections };
      }
    }
  }

  sections.unshift({
    title: PRIVACY_CONSENT_SECTION_TITLE,
    questions: [makePrivacyConsentQuestion()],
  });
  return { ...survey, sections };
}
