import mammoth from 'mammoth';

export type FileKind =
  | 'audio'
  | 'video'
  | 'text'
  | 'docx'
  | 'pdf'
  | 'xlsx'
  | 'unsupported';

const TEXT_RE = /\.(txt|md|markdown|csv|json|log)$/i;
const DOCX_RE = /\.(docx|doc)$/i;
const PDF_RE = /\.pdf$/i;
const XLSX_RE = /\.(xlsx|xls)$/i;
// Extension fallback for audio/video. A `.m4a` recorded on iOS/macOS often
// arrives with an empty or generic MIME (blob upload, some browsers), so
// `file.type.startsWith('audio/')` alone misclassifies it as unsupported →
// 415. Documents already have extension fallbacks (above); this gives AV the
// same treatment. `.webm`/`.ogg` route to VIDEO/AUDIO by extension here, but
// both kinds go through the identical transcription path in convert, so the
// audio-vs-video split is cosmetic.
const AUDIO_RE = /\.(m4a|mp3|wav|aac|ogg|oga|flac|opus|aiff|aif|weba|amr|wma)$/i;
const VIDEO_RE = /\.(mp4|m4v|mov|avi|mkv|webm|mpeg|mpg|wmv|flv|3gp)$/i;

export function classifyFile(file: File): FileKind {
  if (file.type.startsWith('audio/') || AUDIO_RE.test(file.name)) return 'audio';
  if (file.type.startsWith('video/') || VIDEO_RE.test(file.name)) return 'video';
  if (file.type === 'application/pdf' || PDF_RE.test(file.name)) return 'pdf';
  if (
    file.type ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel' ||
    XLSX_RE.test(file.name)
  ) {
    return 'xlsx';
  }
  if (
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    TEXT_RE.test(file.name)
  ) {
    return 'text';
  }
  if (
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    DOCX_RE.test(file.name)
  ) {
    return 'docx';
  }
  return 'unsupported';
}

/**
 * Extract plain text from a non-AV file. Throws on unsupported type.
 * Audio/video go through the OpenAI transcription path instead.
 */
export async function extractDocText(file: File): Promise<string> {
  const kind = classifyFile(file);
  if (kind === 'text') return file.text();
  if (kind === 'docx') {
    const buf = Buffer.from(await file.arrayBuffer());
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (kind === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const buf = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    const { text } = await parser.getText();
    return text;
  }
  if (kind === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const parts: string[] = [];
    wb.eachSheet((sheet) => {
      const lines: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        const maxCol = row.cellCount;
        for (let c = 1; c <= maxCol; c++) {
          cells.push(csvEscape(cellToString(row.getCell(c).value)));
        }
        lines.push(cells.join(','));
      });
      const csv = lines.join('\n');
      if (csv.trim()) parts.push(`# Sheet: ${sheet.name}\n${csv}`);
    });
    return parts.join('\n\n');
  }
  throw new Error(`unsupported_file_type: ${file.type || file.name}`);
}

// Coerces an exceljs cell `value` (which can be a primitive, Date, rich-text
// object, hyperlink object, formula object, or error object) into a plain
// string for CSV serialization.
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray((v as { richText?: unknown }).richText)) {
      return ((v as { richText: { text?: string }[] }).richText)
        .map((r) => r.text ?? '')
        .join('');
    }
    if ('text' in v) return cellToString((v as { text: unknown }).text);
    if ('result' in v) return cellToString((v as { result: unknown }).result);
    if ('error' in v) return String((v as { error: unknown }).error);
    if ('hyperlink' in v) return String((v as { hyperlink: unknown }).hyperlink);
  }
  return String(value);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// ── 확장자 → MIME 폴백 (서버측 MIME 보정) ──────────────────────────────────
//
// 브라우저가 올린 blob 은 MIME 이 비어 있거나 generic(`application/octet-stream`)
// 으로 도착하는 일이 흔하다 — iOS/macOS 의 `.m4a` 가 대표적이고, 그게 바로
// 2026-09-10 "인터뷰 분석이 녹음을 415 로 거절" 사고의 원인이었다(#1320 이
// classifyFile 에 AUDIO_RE/VIDEO_RE 폴백을 넣어 분류는 고쳤다).
//
// classifyFile 은 "이 파일이 무슨 종류냐"까지만 답한다. 위젯 체인의 인제스트
// 어댑터(src/lib/chains/adapters.ts)는 버킷 간 전달 시 object 의 content-type
// 자체를 바로잡아야 하므로 **구체 MIME 문자열**이 필요하다 — 그래서 분류의
// SSOT(위 regex)를 그대로 재사용해 확장자에서 MIME 을 복원한다. 매핑 테이블을
// 따로 두되 판정은 항상 classifyFile 의 regex 를 거치므로, 확장자 목록이 한쪽만
// 늘어나 갈라지는 일이 없다.

const EXT_MIME: Record<string, string> = {
  // audio
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  weba: 'audio/webm',
  amr: 'audio/amr',
  wma: 'audio/x-ms-wma',
  // video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  // text / docs
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  log: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * 파일명 확장자에서 MIME 을 복원한다. classifyFile 이 `unsupported` 로 보는
 * 확장자는 null — 추측한 MIME 으로 거절돼야 할 파일을 통과시키지 않는다.
 *
 * 판정은 classifyFile 에 위임한다(빈 MIME 의 가상 File 로 질의) — 확장자
 * regex 를 두 번 쓰지 않기 위한 의도적 재사용.
 */
export function mimeFromExtension(filename: string): string | null {
  if (classifyFile(new File([], filename, { type: '' })) === 'unsupported') {
    return null;
  }
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_MIME[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * 신뢰할 수 있는 MIME 을 고른다 — 선언된 MIME 이 비었거나 generic 이면 확장자
 * 폴백으로 교체한다. 둘 다 없으면 null(호출측이 거절/보존 판단).
 */
export function resolveMime(
  filename: string,
  declared: string | null | undefined,
): string | null {
  const d = (declared ?? '').trim();
  if (d && d !== 'application/octet-stream' && d !== 'binary/octet-stream') {
    return d;
  }
  return mimeFromExtension(filename);
}
