import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

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
