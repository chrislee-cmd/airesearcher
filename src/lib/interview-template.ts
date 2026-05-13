import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

// Soft cap so a runaway sheet (someone pastes a whole transcript) can't
// turn into 5000 "questions". Above this the parser keeps the first N
// and the API surfaces a warning so the user can edit down.
export const MAX_TEMPLATE_QUESTIONS = 200;

// Lines that obviously aren't questions and should be discarded before
// the user sees the preview. Matches purely literal labels found in
// real interview guides — kept narrow to avoid eating legitimate
// phrasing like "도입질문: 평소에...".
const HEADER_PATTERNS: RegExp[] = [
  /^\s*(질문|질문\s*목록|문항|문항\s*목록|interview\s*questions?)\s*[:：]?\s*$/i,
  /^\s*(no\.?|번호|순번|q|qs)\s*[:：]?\s*$/i,
];

// Strip leading numbering ("1.", "1)", "Q1.", "1번", "①" …) and bullet
// markers ("-", "•", "·") so the stored question text is the bare
// content. We don't strip prefixes that are part of the question (e.g.
// "도입 질문: ...") — only enumeration noise at the very start.
function stripEnumeration(line: string): string {
  let s = line.replace(/^\s+/, '');
  // Circled / Korean / Roman numerals
  s = s.replace(
    /^[①-⑳㉑-㊿Ⅰ-ↈ]+[\.\)\s:．\-]+/,
    '',
  );
  // Q-prefixed numbering
  s = s.replace(/^Q\s*\d+[\.\)\s:．\-]+/i, '');
  // Numeric, optionally "번"
  s = s.replace(/^\d+\s*(번)?[\.\)\s:．\-]+/, '');
  // Bullet markers
  s = s.replace(/^[\-•·＊*]\s+/, '');
  return s.trim();
}

function isLikelyQuestion(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (s.length < 2) return false;
  if (HEADER_PATTERNS.some((re) => re.test(s))) return false;
  return true;
}

function dedupePreservingOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = it.replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function finalize(rawLines: string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of rawLines) {
    const stripped = stripEnumeration(raw);
    if (!isLikelyQuestion(stripped)) continue;
    cleaned.push(stripped);
  }
  return dedupePreservingOrder(cleaned).slice(0, MAX_TEMPLATE_QUESTIONS);
}

// XLSX path: read the first sheet, take the first non-empty column.
// The "first column" heuristic matches how interview guides are typically
// laid out (질문 컬럼 in column A). If A is empty the parser scans across
// to find the first column with text so the user doesn't have to reorder
// their sheet.
export function parseTemplateXlsx(buf: ArrayBuffer): string[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  // header:1 returns array-of-arrays so positional access is stable
  // regardless of whether the sheet has header cells.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });
  if (matrix.length === 0) return [];
  // Pick column index: first column that has at least 2 non-empty cells
  // (single-cell columns are usually labels, not data).
  const colCount = Math.max(...matrix.map((r) => r.length));
  let pickCol = 0;
  for (let c = 0; c < colCount; c++) {
    let nonEmpty = 0;
    for (const row of matrix) {
      const v = row[c];
      if (typeof v === 'string' && v.trim()) nonEmpty += 1;
      else if (typeof v === 'number' && Number.isFinite(v)) nonEmpty += 1;
      if (nonEmpty >= 2) break;
    }
    if (nonEmpty >= 2) {
      pickCol = c;
      break;
    }
  }
  const rawLines: string[] = [];
  for (const row of matrix) {
    const v = row[pickCol];
    if (typeof v === 'string') rawLines.push(v);
    else if (typeof v === 'number' && Number.isFinite(v)) {
      // Numbers in a question column are usually enumeration indices
      // (1, 2, 3 …) — skip; the next column over should have the text.
      // We don't try to "look right" because that's where the real
      // questions live in this case → reparse with pickCol+1.
      continue;
    }
  }
  // If the chosen column was all numeric headers and we ended up with
  // nothing, retry with the next column.
  if (rawLines.length === 0 && pickCol + 1 < colCount) {
    for (const row of matrix) {
      const v = row[pickCol + 1];
      if (typeof v === 'string') rawLines.push(v);
    }
  }
  return finalize(rawLines);
}

// DOCX path: mammoth strips most of Word's formatting to plain text.
// We split on newlines because mammoth uses a single \n between block
// elements — paragraphs, list items, table cells. Numbering markers
// added by Word ("1.", "1)") survive as text, which is why
// stripEnumeration runs in finalize().
export async function parseTemplateDocx(
  buf: ArrayBuffer,
): Promise<string[]> {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(buf),
  });
  const text = result.value ?? '';
  const rawLines = text.split(/\r?\n/);
  return finalize(rawLines);
}

export function parseTemplateBufferByExt(
  filename: string,
  buf: ArrayBuffer,
): Promise<string[]> | string[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseTemplateXlsx(buf);
  }
  if (lower.endsWith('.docx')) {
    return parseTemplateDocx(buf);
  }
  // Plain text fallback — useful for tests and for users who paste a
  // raw .txt list. Not advertised in the UI but harmless to support.
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    const text = new TextDecoder().decode(buf);
    return finalize(text.split(/\r?\n/));
  }
  throw new Error('unsupported_extension');
}
