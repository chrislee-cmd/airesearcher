import type { Survey, SurveyQuestion } from '@/lib/survey-schema';
import {
  PERSONAL_SECTION_TITLE,
  PRIVACY_CONSENT_SECTION_TITLE,
  MANDATORY_PHONE_NOTICE,
  buildPersonalQuestions,
  buildPhoneQuestion,
  buildPrivacyConsentQuestion,
} from './standard-blocks';

// The standard-block constants live in ./standard-blocks (the cached
// template SSOT). They are re-exported here because contact-filter.ts and a
// few callers historically imported them from this module — keep the surface
// stable rather than churn every import site.
export {
  PERSONAL_SECTION_TITLE,
  PRIVACY_CONSENT_SECTION_TITLE,
  PRIVACY_CONSENT_TITLE,
  PRIVACY_CONSENT_AGREE,
  PRIVACY_CONSENT_DENY,
  PRIVACY_CONSENT_DESCRIPTION,
  MANDATORY_PHONE_NOTICE,
  isStandardSectionTitle,
} from './standard-blocks';

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

function normalizeTitle(s: string) {
  return s.replace(/\s+/g, '').toLowerCase();
}

// Idempotent: guarantees the published survey carries the standard 인적사항
// section as its last section. If the last section already is 인적사항 we
// top it up with any missing standard questions (the LLM may have produced a
// partial one); otherwise we append a fresh standard section. The LLM is now
// told not to generate this section at all, so the common path is a clean
// append — but defense-in-depth keeps old behaviour working if it does.
export function ensurePersonalSection(survey: Survey): Survey {
  const standard = buildPersonalQuestions();
  const sections = [...survey.sections];
  const lastIdx = sections.length - 1;
  const last = lastIdx >= 0 ? sections[lastIdx] : null;
  const isPersonal = !!last && last.title.includes(PERSONAL_SECTION_TITLE);
  if (isPersonal) {
    const have = new Set(last.questions.map((q) => normalizeTitle(q.title)));
    const missing = standard.filter((q) => !have.has(normalizeTitle(q.title)));
    if (missing.length === 0) return survey;
    sections[lastIdx] = { ...last, questions: [...last.questions, ...missing] };
    return { ...survey, sections };
  }
  sections.push({ title: PERSONAL_SECTION_TITLE, questions: standard });
  return { ...survey, sections };
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
      sections: [{ title: PERSONAL_SECTION_TITLE, questions: [buildPhoneQuestion()] }],
    };
  }

  const last = sections[sections.length - 1];
  const beforeIdx = last.questions.findIndex(
    (q) => q.kind === 'long_answer' && q.title.includes('100만원'),
  );
  const insertAt = beforeIdx >= 0 ? beforeIdx : last.questions.length;
  last.questions.splice(insertAt, 0, buildPhoneQuestion());
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
        section.questions[i] = buildPrivacyConsentQuestion();
        return { ...survey, sections };
      }
    }
  }

  sections.unshift({
    title: PRIVACY_CONSENT_SECTION_TITLE,
    questions: [buildPrivacyConsentQuestion()],
  });
  return { ...survey, sections };
}

// Single entry point: injects every standard template block in canonical
// order so the LLM only ever produces the domain screening sections in
// between. Order matters and mirrors the original publish-route chain:
//   1. ensurePersonalSection  → append 인적사항 as the last section
//   2. ensureMandatoryPhoneNotice → slot 전화번호 before the 100만원 probe
//   3. ensurePrivacyConsent   → unshift the consent gate as section 0
// All three are idempotent, so calling this on a survey that already has the
// blocks (e.g. an old draft, or the publish route re-applying after the
// wizard) is a no-op beyond normalisation.
export function applyStandardBlocks(survey: Survey): Survey {
  return ensurePrivacyConsent(
    ensureMandatoryPhoneNotice(ensurePersonalSection(survey)),
  );
}
