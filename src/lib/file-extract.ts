import mammoth from 'mammoth';

export type FileKind = 'audio' | 'video' | 'text' | 'docx' | 'unsupported';

const TEXT_RE = /\.(txt|md|markdown|csv|json|log)$/i;
const DOCX_RE = /\.(docx|doc)$/i;

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
  throw new Error(`unsupported_file_type: ${file.type || file.name}`);
}
