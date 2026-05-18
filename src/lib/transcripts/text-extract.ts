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

// Matches a timestamped utterance line. Accepts three timestamp forms:
//   [2026-05-18 13:00:11]    (date + time)
//   [13:00:11] or [01:30]    (clock time)
//   [00:11] or [01:23:45]    (offset)
// then optional whitespace, then "Speaker : utterance" — speaker is the chunk
// up to the first colon (Latin `:` or fullwidth `：`), constrained to keep us
// from swallowing colons that legitimately appear inside an utterance.
const TIMESTAMPED_LINE_RE =
  /^\[(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:：\n]{1,40}?)\s*[:：]\s*(.*)$/;

// Extract just the time portion (HH:MM[:SS]) from any of the accepted forms.
function shortTime(stamp: string): string {
  const m = /(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(stamp);
  return m ? m[1]! : stamp;
}

type Block = { time: string; speaker: string; text: string };

// Lightly format raw transcript-style plain text into markdown that matches
// the audio-transcript output (front matter + `[HH:MM:SS] Speaker: text`).
//
// Two paths:
//   1. The file looks like a timestamped transcript → parse blocks, merge
//      continuation lines, emit in the audio-transcript shape.
//   2. Otherwise → preserve content as a titled markdown document.
export function formatAsMarkdown(filename: string, raw: string): string {
  const titleBase = filename.replace(/\.[^.]+$/, '');

  const lines = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  // ── Try the timestamped-transcript path first ────────────────────────────
  const blocks: Block[] = [];
  let current: Block | null = null;
  let nonEmptyLines = 0;

  for (const line of lines) {
    if (line === '') {
      // Blank line ends the current block's continuation window.
      current = null;
      continue;
    }
    nonEmptyLines += 1;
    const m = TIMESTAMPED_LINE_RE.exec(line);
    if (m) {
      const block: Block = {
        time: shortTime(m[1]!),
        speaker: m[2]!.trim(),
        text: m[3]!.trim(),
      };
      blocks.push(block);
      current = block;
    } else if (current) {
      // Continuation of the previous utterance — append on its own paragraph
      // line so multi-paragraph turns stay legible.
      current.text = current.text ? `${current.text}\n\n${line}` : line;
    } else {
      // Pre-amble line before any timestamp — keep it as a header note.
      blocks.push({ time: '', speaker: '', text: line });
    }
  }

  const timestampedCount = blocks.filter((b) => b.time).length;
  const looksLikeTranscript =
    timestampedCount >= 2 && timestampedCount / nonEmptyLines > 0.05;

  if (!looksLikeTranscript) {
    return formatAsPlainMarkdown(titleBase, raw);
  }

  const speakers = new Set(
    blocks.map((b) => b.speaker).filter((s) => s.length > 0),
  );

  const front = [
    '---',
    `file: ${titleBase}`,
    `speakers: ${speakers.size}`,
    '---',
    '',
  ].join('\n');

  const body = blocks
    .map((b) => {
      if (!b.time && !b.speaker) return b.text;
      const prefix = b.time ? `[${b.time}] ` : '';
      return b.speaker ? `${prefix}${b.speaker}: ${b.text}` : `${prefix}${b.text}`;
    })
    .join('\n\n');

  return `${front}\n${body}\n`;
}

function formatAsPlainMarkdown(title: string, raw: string): string {
  const cleaned = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of cleaned) {
    if (line === '') {
      blankRun += 1;
      if (blankRun <= 1) collapsed.push('');
    } else {
      blankRun = 0;
      collapsed.push(line);
    }
  }

  return `# ${title}\n\n${collapsed.join('\n').trim()}\n`;
}
