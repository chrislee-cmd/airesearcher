import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

// Personal-info (PII) column detection for the recruiting fullview
// spreadsheet. Columns whose title matches one of these keywords are
// treated as PII: pulled to the left of the table, masked by default, and
// gated behind a per-respondent credit unlock.
//
// This is intentionally broader than `contact-filter`'s phone/email strip
// (which only hides contact channels). Here we also gate name / address /
// birth / age, because the fullview surfaces the *whole* respondent record
// and the recruiter must pay to de-anonymise an individual.
//
// Keyword-substring matching (lower-cased) — matches whatever the recruiter
// or the LLM wrote as the question title. Kept conservative: erring toward
// classifying a column as PII (and masking it) is the privacy-safe default.
export const PII_KEYWORDS: readonly string[] = [
  '이름', '성함', 'name', '전화', '연락처', 'phone', 'tel',
  '이메일', 'email', 'e-mail', '주소', 'address',
  '생년월일', '나이', 'age', 'birth',
];

export function isPiiColumn(header: string): boolean {
  const h = header.toLowerCase().trim();
  return PII_KEYWORDS.some((kw) => h.includes(kw));
}

// questionIds of the PII columns in a form's column set.
export function piiQuestionIds(columns: FormColumn[]): string[] {
  return columns.filter((c) => isPiiColumn(c.title)).map((c) => c.questionId);
}

// Server-side mask: blank out the PII answer values so the raw personal
// info never reaches the browser on the initial responses load. The column
// (and its title) is still sent so the client can render a masked, unlockable
// cell — only the *value* is withheld until the respondent's row is paid for.
// A non-empty PII answer is replaced with a fixed mask token; an empty one
// stays empty so the unlocked view can distinguish "no answer" from a value.
export const PII_MASK = '••••';

export function maskPiiAnswers(
  rows: FormResponseRow[],
  piiQids: Set<string>,
): FormResponseRow[] {
  if (piiQids.size === 0) return rows;
  return rows.map((r) => {
    const answers: Record<string, string> = {};
    for (const [qid, val] of Object.entries(r.answers)) {
      answers[qid] = piiQids.has(qid) ? (val ? PII_MASK : '') : val;
    }
    return { ...r, answers };
  });
}

// Extract only the PII answers for a single row — used by the unlock route
// to return the real values after a successful charge.
export function extractPiiAnswers(
  row: FormResponseRow,
  piiQids: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [qid, val] of Object.entries(row.answers)) {
    if (piiQids.has(qid)) out[qid] = val;
  }
  return out;
}
