import mammoth from 'mammoth';

export type FileKind =
  | 'audio'
  | 'video'
  | 'text'
  | 'docx'
  | 'hwp'
  | 'unsupported';

const TEXT_RE = /\.(txt|md|markdown|csv|json|log)$/i;
const DOCX_RE = /\.(docx|doc)$/i;
const HWP_RE = /\.(hwp|hwpx)$/i;

export function classifyFile(file: File): FileKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
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
  if (HWP_RE.test(file.name)) return 'hwp';
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
  if (kind === 'hwp') {
    return extractHwpText(await file.arrayBuffer());
  }
  throw new Error(`unsupported_file_type: ${file.type || file.name}`);
}

async function extractHwpText(buffer: ArrayBuffer): Promise<string> {
  // hwp.js is CJS-only and parses HWP 5.x binary files into a tree of
  // sections → paragraphs → HWPChar nodes. CharType.Char (0) holds the
  // actual rendered character; Inline / Extended chars are control codes
  // we can ignore for plain-text extraction.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const hwp = require('hwp.js');
  const doc = hwp.parse(new Uint8Array(buffer), { type: 'array' });

  const lines: string[] = [];
  for (const section of doc.sections ?? []) {
    for (const paragraph of section.content ?? []) {
      let line = '';
      for (const ch of paragraph.content ?? []) {
        if (ch?.type === 0 && typeof ch.value === 'string') {
          line += ch.value;
        } else if (ch?.type === 0 && typeof ch.value === 'number') {
          line += String.fromCharCode(ch.value);
        }
      }
      lines.push(line);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
