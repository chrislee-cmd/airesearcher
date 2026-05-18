// Server-side text/docx extraction for the transcript pipeline.
// Mirrors `file-extract.ts` but operates on Buffer (from Supabase Storage)
// instead of a browser `File`. Text files skip Deepgram entirely — we just
// format the content as markdown and mark the job done.

import mammoth from 'mammoth';

const TEXT_RE = /\.(txt|md|markdown|csv|json|log)$/i;
const DOCX_RE = /\.(docx|doc)$/i;

export type TextFileKind = 'text' | 'docx' | null;

export function classifyTextFile(filename: string): TextFileKind {
  if (DOCX_RE.test(filename)) return 'docx';
  if (TEXT_RE.test(filename)) return 'text';
  return null;
}

export async function extractTextFromBuffer(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const kind = classifyTextFile(filename);
  if (kind === 'text') return buffer.toString('utf8');
  if (kind === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error(`unsupported_text_kind: ${filename}`);
}

// Lightly format raw transcript-style plain text into clean markdown.
// We do not try to *interpret* the content — only structure it so the result
// renders as a transcript card consistent with audio-transcribed outputs.
//
// Rules:
//   - Strip BOM and normalize line endings.
//   - Collapse runs of >2 blank lines.
//   - Lines like `이름:` or `Interviewer:` followed by an utterance become
//     `**이름**: utterance` (only when the prefix is short — under 20 chars
//     before the colon — to avoid mangling sentences with mid-text colons).
//   - Preserve everything else verbatim.
export function formatAsMarkdown(filename: string, raw: string): string {
  const titleBase = filename.replace(/\.[^.]+$/, '');

  const cleaned = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

  const SPEAKER_RE = /^([^:：\n]{1,20})[:：]\s*(.*)$/;
  const formatted: string[] = [];
  for (const line of cleaned) {
    if (line === '') {
      formatted.push('');
      continue;
    }
    const m = SPEAKER_RE.exec(line);
    if (m && m[1] && !/^https?$/i.test(m[1])) {
      const speaker = m[1].trim();
      const utter = m[2].trim();
      formatted.push(utter ? `**${speaker}**: ${utter}` : `**${speaker}**:`);
      continue;
    }
    formatted.push(line);
  }

  // Collapse runs of >2 blank lines into exactly 1 blank line.
  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of formatted) {
    if (line === '') {
      blankRun += 1;
      if (blankRun <= 1) collapsed.push('');
    } else {
      blankRun = 0;
      collapsed.push(line);
    }
  }

  return `# ${titleBase}\n\n${collapsed.join('\n').trim()}\n`;
}
