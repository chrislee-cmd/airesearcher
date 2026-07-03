import type { FormColumn, FormResponseRow } from '@/lib/google-forms';

// Personal-info (PII) column detection for the recruiting fullview
// spreadsheet. Columns whose title matches one of these keywords are
// treated as PII: pulled to the left of the table, masked by default, and
// gated behind a per-respondent credit unlock.
//
// Narrowly scoped to *name* and *phone* only — the recruiter explicitly asked
// for just these two to be gated. Address / email / age / birth were removed:
// substring matching over a broad keyword list produced false positives (e.g.
// "게임 이름" / "제품 이름" matched "이름" and got locked, pushing recruiters into
// a pointless re-charge to unlock a non-PII column). Extend via a separate spec
// if more categories are genuinely needed.
//
// Exact matching (whitespace/separator-stripped, lower-cased) — the column title
// must *equal* one of these tokens, not merely contain it. This is what kills the
// "게임 이름" false positive while still catching "연락 가능한 전화번호".
export const PII_EXACT: readonly string[] = [
  // 이름 계열
  '이름', '성명', '성함', 'name',
  // 전화 계열
  '전화번호', '전화', '연락처', '휴대폰', '휴대폰번호', '핸드폰', '핸드폰번호',
  '연락가능한전화번호', '연락가능한번호',
  'phone', 'tel', 'mobile', 'phonenumber',
];

const normalize = (s: string): string => s.replace(/[\s\-_.()]/g, '').toLowerCase();

// Precomputed normalized whitelist for exact-equality lookup.
const PII_EXACT_NORMALIZED = new Set(PII_EXACT.map(normalize));

export function isPiiColumn(header: string): boolean {
  return PII_EXACT_NORMALIZED.has(normalize(header));
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
