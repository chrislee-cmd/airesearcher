import type { Survey, SurveyQuestion } from '@/lib/survey-schema';

// Mandatory phone-contact notice required on every survey we publish.
// The LLM that generates the survey is constrained but not perfect, so we
// enforce this post-process step (idempotent) on the client + the publish
// route as a defense-in-depth check.
export const MANDATORY_PHONE_NOTICE =
  '인터뷰 대상자로 선정되셨을 때 연락을 드릴 수 있도록 전화번호를 정확히 적어주세요';

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
