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

export function classifyFile(file: File): FileKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
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
