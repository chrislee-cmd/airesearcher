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
    const XLSX = await import('xlsx');
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) parts.push(`# Sheet: ${name}\n${csv}`);
    }
    return parts.join('\n\n');
  }
  throw new Error(`unsupported_file_type: ${file.type || file.name}`);
}
