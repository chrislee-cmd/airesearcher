import { parseCsvString } from '@/lib/csv-parse';
import { parseXlsxToRows } from '@/lib/xlsx-parse';

// Parse a candidate upload (CSV or XLSX) into normalized rows. email/name/phone
// are mapped off a multi-locale header alias table (mirrors scheduler/csv.ts);
// every other column is preserved verbatim under `fields`.
//
// email is OPTIONAL (product decision 2026-07-21) — phone-only, name-only, or
// even fully anonymous rows are kept. Merge/dedup happens by best-available
// identity (email > phone > name); rows with no identity are always distinct.

// The non-ASCII entries below are header-matching TOKENS for uploaded
// spreadsheets (a Korean sheet may label the column "이메일"), not UI copy —
// they must stay as literals so parsing works. Mirrors scheduler/csv.ts's
// alias tables.
const EMAIL_KEYS = [
  'email', 'mail', 'emailaddress', 'e-mail',
  // i18n-allow-korean -- 업로드 스프레드시트 헤더 매칭 토큰(UI 아님)
  '메일', '이메일',
  'メール', 'メールアドレス',
  'อีเมล',
];
const NAME_KEYS = [
  'name', 'fullname', 'candidate', 'participant',
  // i18n-allow-korean -- 업로드 스프레드시트 헤더 매칭 토큰(UI 아님)
  '이름', '성함', '닉네임', '후보자', '참여자',
  '氏名', '名前',
  'ชื่อ',
];
const PHONE_KEYS = [
  'phone', 'mobile', 'tel', 'cellphone', 'contact', 'phonenumber',
  // i18n-allow-korean -- 업로드 스프레드시트 헤더 매칭 토큰(UI 아님)
  '전화', '전화번호', '연락처', '휴대폰', '핸드폰',
  '電話', '携帯',
  'โทรศัพท์', 'เบอร์โทร',
];

export type ParsedCandidate = {
  email: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
};

export type ParseCandidatesResult = {
  candidates: ParsedCandidate[];
  headers: string[];
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_\-./]/g, '');
}

function findKey(headers: string[], candidates: string[]): string | null {
  const wanted = candidates.map(normalize);
  for (const h of headers) if (wanted.includes(normalize(h))) return h;
  return null;
}

function decodeCsvBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (hasUtf8Bom) return new TextDecoder('utf-8').decode(buf);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const utf8Bad = (utf8.match(/�/g) ?? []).length;
  if (utf8Bad === 0) return utf8;
  const candidates = ['euc-kr', 'windows-874', 'shift-jis', 'gbk'];
  let best = utf8;
  let bestBad = utf8Bad;
  for (const enc of candidates) {
    try {
      const decoded = new TextDecoder(enc, { fatal: false }).decode(buf);
      const bad = (decoded.match(/�/g) ?? []).length;
      if (bad < bestBad) {
        best = decoded;
        bestBad = bad;
      }
    } catch {
      // unsupported codec on this runtime — skip
    }
  }
  return best;
}

function toStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return typeof v === 'string' ? v : String(v);
}

// Best-available identity for merge/dedup. null = anonymous (never merges).
export function candidateIdentity(c: ParsedCandidate): string | null {
  if (c.email) return `e:${c.email.trim().toLowerCase()}`;
  if (c.phone) {
    const digits = c.phone.replace(/\D/g, '');
    if (digits) return `p:${digits}`;
  }
  if (c.name) return `n:${c.name.trim().toLowerCase()}`;
  return null;
}

export async function parseCandidateFile(file: File): Promise<ParseCandidatesResult> {
  const buf = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const { headers, rows } = isCsv
    ? parseCsvString(decodeCsvBuffer(buf))
    : await parseXlsxToRows(buf);

  if (rows.length === 0) return { candidates: [], headers: [] };

  const emailKey = findKey(headers, EMAIL_KEYS);
  const nameKey = findKey(headers, NAME_KEYS);
  const phoneKey = findKey(headers, PHONE_KEYS);
  const reserved = new Set([emailKey, nameKey, phoneKey].filter(Boolean) as string[]);

  const parsed: ParsedCandidate[] = [];
  for (const row of rows) {
    const fields: Record<string, string> = {};
    for (const h of headers) {
      if (reserved.has(h)) continue;
      const s = toStr(row[h]).trim();
      if (s !== '') fields[h] = s;
    }
    parsed.push({
      email: emailKey ? toStr(row[emailKey]).trim().toLowerCase() || null : null,
      name: nameKey ? toStr(row[nameKey]).trim() || null : null,
      phone: phoneKey ? toStr(row[phoneKey]).trim() || null : null,
      fields,
    });
  }

  // Merge within a single file by identity (last row wins on scalars, fields
  // union) so the DB upsert never sees two rows sharing one identity in one
  // call. Anonymous rows (no identity) are kept distinct.
  const byIdentity = new Map<string, ParsedCandidate>();
  const anonymous: ParsedCandidate[] = [];
  for (const c of parsed) {
    const key = candidateIdentity(c);
    if (key == null) {
      anonymous.push(c);
      continue;
    }
    const prev = byIdentity.get(key);
    if (prev) {
      byIdentity.set(key, {
        email: c.email ?? prev.email,
        name: c.name ?? prev.name,
        phone: c.phone ?? prev.phone,
        fields: { ...prev.fields, ...c.fields },
      });
    } else {
      byIdentity.set(key, c);
    }
  }

  return { candidates: [...byIdentity.values(), ...anonymous], headers };
}
