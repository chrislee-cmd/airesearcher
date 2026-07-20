import { parseCsvString } from '@/lib/csv-parse';
import { parseXlsxToRows } from '@/lib/xlsx-parse';

// Parse a candidate upload (CSV or XLSX) into normalized rows. email/name/phone
// are mapped off a multi-locale header alias table (mirrors scheduler/csv.ts);
// every other column is preserved verbatim under `fields` so nothing the
// uploader put in the sheet is lost. Rows without an email are dropped — email
// is the upsert key (unique(batch_id,email)) and the column is NOT NULL.

const EMAIL_KEYS = [
  'email', 'mail', 'emailaddress', 'e-mail',
  '메일', '이메일',
  'メール', 'メールアドレス',
  'อีเมล',
];
const NAME_KEYS = [
  'name', 'fullname', 'candidate', 'participant',
  '이름', '성함', '닉네임', '후보자', '참여자',
  '氏名', '名前',
  'ชื่อ',
];
const PHONE_KEYS = [
  'phone', 'mobile', 'tel', 'cellphone', 'contact', 'phonenumber',
  '전화', '전화번호', '연락처', '휴대폰', '핸드폰',
  '電話', '携帯',
  'โทรศัพท์', 'เบอร์โทร',
];

export type ParsedCandidate = {
  email: string;
  name: string | null;
  phone: string | null;
  fields: Record<string, string>;
};

export type ParseCandidatesResult = {
  candidates: ParsedCandidate[];
  headers: string[];
  skippedNoEmail: number;
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

export async function parseCandidateFile(file: File): Promise<ParseCandidatesResult> {
  const buf = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const { headers, rows } = isCsv
    ? parseCsvString(decodeCsvBuffer(buf))
    : await parseXlsxToRows(buf);

  if (rows.length === 0) return { candidates: [], headers: [], skippedNoEmail: 0 };

  const emailKey = findKey(headers, EMAIL_KEYS);
  const nameKey = findKey(headers, NAME_KEYS);
  const phoneKey = findKey(headers, PHONE_KEYS);
  const reserved = new Set([emailKey, nameKey, phoneKey].filter(Boolean) as string[]);

  const candidates: ParsedCandidate[] = [];
  let skippedNoEmail = 0;

  for (const row of rows) {
    const email = emailKey ? toStr(row[emailKey]).trim().toLowerCase() : '';
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    const fields: Record<string, string> = {};
    for (const h of headers) {
      if (reserved.has(h)) continue;
      const s = toStr(row[h]).trim();
      if (s !== '') fields[h] = s;
    }
    candidates.push({
      email,
      name: nameKey ? toStr(row[nameKey]).trim() || null : null,
      phone: phoneKey ? toStr(row[phoneKey]).trim() || null : null,
      fields,
    });
  }

  // De-dupe within a single file by email (last row wins, fields merged) so the
  // DB upsert never sees two rows with the same (batch_id,email) in one call.
  const byEmail = new Map<string, ParsedCandidate>();
  for (const c of candidates) {
    const prev = byEmail.get(c.email);
    if (prev) {
      byEmail.set(c.email, {
        email: c.email,
        name: c.name ?? prev.name,
        phone: c.phone ?? prev.phone,
        fields: { ...prev.fields, ...c.fields },
      });
    } else {
      byEmail.set(c.email, c);
    }
  }

  return { candidates: [...byEmail.values()], headers, skippedNoEmail };
}
