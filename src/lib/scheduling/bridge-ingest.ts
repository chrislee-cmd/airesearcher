import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import type { ParsedCandidate } from './candidates-parse';

// Map selected Google Forms responses → scheduling candidates for the bridge
// auto-ingest (invitation approval hook). Runs SERVER-ONLY: the raw contact
// values never reach the browser here — they're written straight into
// sched_candidates and thereafter masked per source for non-super-admins.
//
// Column classification mirrors the upload alias tables (candidates-parse.ts):
// a response column is claimed as email / phone / name by matching its TITLE
// (priority email > phone > name); every other column is carried verbatim into
// `fields` keyed by its title, so the roster keeps the survey answers alongside
// the contact. Contact detection here is intentionally broader than the strict
// PII-lock predicate because we WANT to capture the contact for sending.

const normalize = (s: string): string =>
  s.replace(/[\s\-_.()]/g, '').toLowerCase();

// Substring tokens — a survey often embeds the field in a longer label
// ("연락 가능한 전화번호", "이메일 주소를 입력해주세요"). email > phone > name.
const EMAIL_TOKENS = ['이메일', '메일', 'email', 'mail', 'メール', 'อีเมล'];
const PHONE_TOKENS = [
  '전화번호', '전화', '연락처', '연락가능', '휴대폰', '핸드폰', '핸드폰번호',
  'phonenumber', 'phone', 'mobile', 'tel', '電話', '携帯', 'โทรศัพท์', 'เบอร์โทร',
];
const NAME_TOKENS = ['이름', '성명', '성함', '닉네임', 'name', 'fullname', '氏名', '名前', 'ชื่อ'];

function matchesAny(title: string, tokens: string[]): boolean {
  const n = normalize(title);
  return tokens.map(normalize).some((t) => n.includes(t));
}

type ContactMap = {
  emailQid: string | null;
  phoneQid: string | null;
  nameQid: string | null;
};

// Classify a form's columns once. Each contact field claims at most one column;
// a column already claimed by a higher-priority field can't be reused.
export function classifyContactColumns(columns: FormColumn[]): ContactMap {
  const taken = new Set<string>();
  const claim = (tokens: string[]): string | null => {
    for (const c of columns) {
      if (taken.has(c.questionId)) continue;
      if (matchesAny(c.title, tokens)) {
        taken.add(c.questionId);
        return c.questionId;
      }
    }
    return null;
  };
  const emailQid = claim(EMAIL_TOKENS);
  const phoneQid = claim(PHONE_TOKENS);
  const nameQid = claim(NAME_TOKENS);
  return { emailQid, phoneQid, nameQid };
}

// Build candidate rows from response rows. Non-contact answers land in `fields`
// keyed by the human column title (so the roster shows them as dynamic columns).
export function responsesToCandidates(
  columns: FormColumn[],
  rows: FormResponseRow[],
): ParsedCandidate[] {
  const { emailQid, phoneQid, nameQid } = classifyContactColumns(columns);
  const contactQids = new Set(
    [emailQid, phoneQid, nameQid].filter((v): v is string => !!v),
  );
  const titleByQid = new Map(columns.map((c) => [c.questionId, c.title]));

  return rows.map((r) => {
    const fields: Record<string, string> = {};
    for (const [qid, val] of Object.entries(r.answers)) {
      if (contactQids.has(qid)) continue;
      const v = (val ?? '').trim();
      if (v === '') continue;
      const title = titleByQid.get(qid) ?? qid;
      fields[title] = v;
    }
    const email = emailQid ? (r.answers[emailQid] ?? '').trim().toLowerCase() || null : null;
    const phone = phoneQid ? (r.answers[phoneQid] ?? '').trim() || null : null;
    const name = nameQid ? (r.answers[nameQid] ?? '').trim() || null : null;
    return { email, name, phone, fields };
  });
}
