import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import { PRIVACY_CONSENT_AGREE } from '@/lib/recruiting/survey-postprocess';

// Privacy guard: contact-bearing question columns (phone number / email)
// are stripped server-side before the responses payload reaches the
// browser. The same predicate is used to hide columns in the attendee
// review modal as a second line of defense.
//
// We deliberately key on substrings present in the column *title* — that
// matches whatever the recruiter (or LLM) wrote in the form. The list
// covers Korean and English variants we expect, scoped narrowly enough
// that device columns like "핸드폰 브랜드" / "핸드폰 모델명" are NOT
// matched (those carry no contact value).
const CONTACT_TITLE_RE =
  /전화\s*번호|연락처|이메일|메일|phone\s*number|mobile\s*number|email/i;

export function isContactColumnTitle(title: string): boolean {
  return CONTACT_TITLE_RE.test(title);
}

// Mirrors isPrivacyConsentQuestion (survey-postprocess) but operates on
// response-column titles. Both "개인정보" and "동의" must appear so we
// don't false-match "동의 및 일정" scheduling questions.
export function isPrivacyConsentColumnTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (/privacy.{0,5}consent/.test(t)) return true;
  return t.includes('개인정보') && t.includes('동의');
}

export function findConsentColumn(columns: FormColumn[]): FormColumn | null {
  return columns.find((c) => isPrivacyConsentColumnTitle(c.title)) ?? null;
}

// Drops rows where the consent column is not the affirmative value. Used
// server-side so non-consenting responses never reach the browser nor
// the recruiter's view — defense-in-depth against accidental processing
// of data we don't have legal grounds to use.
export function filterConsentedRows(
  rows: FormResponseRow[],
  consent: FormColumn | null,
): FormResponseRow[] {
  if (!consent) return rows;
  return rows.filter((r) => r.answers[consent.questionId] === PRIVACY_CONSENT_AGREE);
}

export function partitionContactColumns(columns: FormColumn[]): {
  visible: FormColumn[];
  hiddenQuestionIds: Set<string>;
} {
  const hiddenQuestionIds = new Set<string>();
  const visible: FormColumn[] = [];
  for (const c of columns) {
    if (isContactColumnTitle(c.title)) {
      hiddenQuestionIds.add(c.questionId);
    } else {
      visible.push(c);
    }
  }
  return { visible, hiddenQuestionIds };
}

export function stripContactAnswers(
  rows: FormResponseRow[],
  hiddenQuestionIds: Set<string>,
): FormResponseRow[] {
  if (hiddenQuestionIds.size === 0) return rows;
  return rows.map((r) => {
    const answers: Record<string, string> = {};
    for (const [qid, val] of Object.entries(r.answers)) {
      if (!hiddenQuestionIds.has(qid)) answers[qid] = val;
    }
    return { ...r, answers };
  });
}
