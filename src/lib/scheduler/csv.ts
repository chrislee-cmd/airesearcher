import * as XLSX from 'xlsx';
import type { Attendee, ConfirmedSlot, HHmm, IsoDate } from './types';

const NAME_KEYS = ['name', '이름', '성함', '닉네임', '참석자'];
const PHONE_KEYS = ['phone', 'mobile', 'tel', 'cellphone', '전화', '전화번호', '연락처', '휴대폰', '핸드폰'];
const EMAIL_KEYS = ['email', '메일', '이메일'];
const NOTE_KEYS = ['note', 'memo', 'comment', '메모', '비고'];
const DATE_KEYS = ['date', 'day', '날짜', '일자', '일정일'];
const START_KEYS = ['start', 'starttime', 'from', 'begin', '시작', '시작시간'];
const END_KEYS = ['end', 'endtime', 'to', 'finish', '종료', '종료시간'];
const TIME_KEYS = ['time', '시간'];

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_\-./]/g, '');
}

function keyMatches(header: string, candidates: string[]): boolean {
  const n = normalize(header);
  return candidates.some((c) => n === normalize(c));
}

function findKey(headers: string[], candidates: string[]): string | null {
  for (const h of headers) if (keyMatches(h, candidates)) return h;
  return null;
}

function toIsoDate(v: unknown): IsoDate | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // already YYYY-MM-DD
  const m1 = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  // YYYY/MM/DD with no separator? skip
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function toHHmm(v: unknown): HHmm | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // "14:30", "14:30:00", "2:30 pm"
  const ampm = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const mm = Number(ampm[2]);
    const suffix = ampm[3]?.toLowerCase();
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  // bare hour like "14" or "9"
  const bare = s.match(/^(\d{1,2})\s*(am|pm)?$/i);
  if (bare) {
    let h = Number(bare[1]);
    const suffix = bare[2]?.toLowerCase();
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

function addMinutes(t: HHmm, mins: number): HHmm {
  const [h, m] = t.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + mins;
  const hh = Math.max(0, Math.min(23, Math.floor(total / 60)));
  const mm = Math.max(0, Math.min(59, total % 60));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export type ImportResult = {
  attendees: Attendee[];
  slots: { attendeeId: string; date: IsoDate; start: HHmm; end: HHmm }[];
};

function decodeCsvBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (hasUtf8Bom) return new TextDecoder('utf-8').decode(buf);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('euc-kr', { fatal: false }).decode(buf);
  } catch {
    return utf8;
  }
}

export async function parseAttendeeFile(file: File, defaultDurationMin = 60): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  const wb = isCsv
    ? XLSX.read(decodeCsvBuffer(buf), { type: 'string', cellDates: true })
    : XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { attendees: [], slots: [] };
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  if (rows.length === 0) return { attendees: [], slots: [] };
  const headers = Object.keys(rows[0]);

  const nameKey = findKey(headers, NAME_KEYS);
  const phoneKey = findKey(headers, PHONE_KEYS);
  const emailKey = findKey(headers, EMAIL_KEYS);
  const noteKey = findKey(headers, NOTE_KEYS);
  const dateKey = findKey(headers, DATE_KEYS);
  const startKey = findKey(headers, START_KEYS) ?? findKey(headers, TIME_KEYS);
  const endKey = findKey(headers, END_KEYS);

  const reservedKeys = new Set(
    [nameKey, phoneKey, emailKey, noteKey, dateKey, startKey, endKey].filter(Boolean) as string[],
  );

  const attendees: Attendee[] = [];
  const slots: ImportResult['slots'] = [];

  for (const row of rows) {
    const rawName = nameKey ? String(row[nameKey] ?? '').trim() : '';
    if (!rawName) continue;

    const customFields: Record<string, string> = {};
    for (const h of headers) {
      if (reservedKeys.has(h)) continue;
      const v = row[h];
      if (v == null || v === '') continue;
      customFields[h] = typeof v === 'string' ? v : String(v);
    }

    const attendee: Attendee = {
      id: crypto.randomUUID(),
      name: rawName,
      phone: phoneKey ? String(row[phoneKey] ?? '').trim() || undefined : undefined,
      email: emailKey ? String(row[emailKey] ?? '').trim() || undefined : undefined,
      note: noteKey ? String(row[noteKey] ?? '').trim() || undefined : undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    };
    attendees.push(attendee);

    const date = dateKey ? toIsoDate(row[dateKey]) : null;
    const start = startKey ? toHHmm(row[startKey]) : null;
    if (date && start) {
      const end = (endKey ? toHHmm(row[endKey]) : null) ?? addMinutes(start, defaultDurationMin);
      slots.push({ attendeeId: attendee.id, date, start, end });
    }
  }

  return { attendees, slots };
}
