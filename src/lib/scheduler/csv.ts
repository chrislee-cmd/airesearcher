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
  headers: string[];
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
  if (!sheetName) return { attendees: [], slots: [], headers: [] };
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  if (rows.length === 0) return { attendees: [], slots: [], headers: [] };
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
    const sourceRow: Record<string, string> = {};
    for (const h of headers) {
      const v = row[h];
      const s = v == null ? '' : typeof v === 'string' ? v : String(v);
      sourceRow[h] = s;
      if (reservedKeys.has(h) || s === '') continue;
      customFields[h] = s;
    }

    const attendee: Attendee = {
      id: crypto.randomUUID(),
      name: rawName,
      phone: phoneKey ? String(row[phoneKey] ?? '').trim() || undefined : undefined,
      email: emailKey ? String(row[emailKey] ?? '').trim() || undefined : undefined,
      note: noteKey ? String(row[noteKey] ?? '').trim() || undefined : undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
      sourceRow,
    };
    attendees.push(attendee);

    const date = dateKey ? toIsoDate(row[dateKey]) : null;
    const start = startKey ? toHHmm(row[startKey]) : null;
    if (date && start) {
      const end = (endKey ? toHHmm(row[endKey]) : null) ?? addMinutes(start, defaultDurationMin);
      slots.push({ attendeeId: attendee.id, date, start, end });
    }
  }

  return { attendees, slots, headers };
}

const CONFIRMED_DATE = 'confirmed_date';
const CONFIRMED_START = 'confirmed_start';
const CONFIRMED_END = 'confirmed_end';

export type ExportFormat = 'csv' | 'xlsx';

export function buildExportRows(
  attendees: Attendee[],
  confirmed: ConfirmedSlot[],
  importHeaders: string[],
): { headers: string[]; rows: Record<string, string>[] } {
  const slotByAttendee = new Map(confirmed.map((c) => [c.attendeeId, c]));

  const customFieldKeys = new Set<string>();
  for (const a of attendees) {
    if (a.customFields) for (const k of Object.keys(a.customFields)) customFieldKeys.add(k);
  }

  const baseHeaders: string[] = [];
  if (importHeaders.length > 0) {
    baseHeaders.push(...importHeaders);
    for (const a of attendees) {
      if (!a.sourceRow) continue;
      for (const k of Object.keys(a.sourceRow)) {
        if (!baseHeaders.includes(k)) baseHeaders.push(k);
      }
    }
  } else {
    baseHeaders.push('name', 'email', 'phone', 'note');
    for (const k of customFieldKeys) {
      if (!baseHeaders.includes(k)) baseHeaders.push(k);
    }
  }

  const headers = [...baseHeaders];
  for (const k of [CONFIRMED_DATE, CONFIRMED_START, CONFIRMED_END]) {
    if (!headers.includes(k)) headers.push(k);
  }

  const rows: Record<string, string>[] = attendees.map((a) => {
    const row: Record<string, string> = {};
    for (const h of baseHeaders) row[h] = '';

    if (a.sourceRow) {
      for (const [k, v] of Object.entries(a.sourceRow)) row[k] = v;
    } else {
      row.name = a.name;
      if (a.email) row.email = a.email;
      if (a.phone) row.phone = a.phone;
      if (a.note) row.note = a.note;
      if (a.customFields) {
        for (const [k, v] of Object.entries(a.customFields)) row[k] = v;
      }
    }

    const slot = slotByAttendee.get(a.id);
    row[CONFIRMED_DATE] = slot?.date ?? '';
    row[CONFIRMED_START] = slot?.start ?? '';
    row[CONFIRMED_END] = slot?.end ?? '';
    return row;
  });

  return { headers, rows };
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function attendeesToCsv(
  attendees: Attendee[],
  confirmed: ConfirmedSlot[],
  importHeaders: string[],
): string {
  const { headers, rows } = buildExportRows(attendees, confirmed, importHeaders);
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h] ?? '')).join(','));
  return '﻿' + lines.join('\r\n');
}

export function attendeesToXlsxBlob(
  attendees: Attendee[],
  confirmed: ConfirmedSlot[],
  importHeaders: string[],
): Blob {
  const { headers, rows } = buildExportRows(attendees, confirmed, importHeaders);
  const aoa: (string | number)[][] = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'attendees');
  const buf: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadAttendees(
  format: ExportFormat,
  attendees: Attendee[],
  confirmed: ConfirmedSlot[],
  importHeaders: string[],
  baseName = 'attendees',
) {
  if (typeof window === 'undefined') return;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${baseName}-${stamp}.${format}`;
  const blob =
    format === 'csv'
      ? new Blob([attendeesToCsv(attendees, confirmed, importHeaders)], {
          type: 'text/csv;charset=utf-8',
        })
      : attendeesToXlsxBlob(attendees, confirmed, importHeaders);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
