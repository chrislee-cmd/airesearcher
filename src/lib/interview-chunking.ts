// Heading-aware markdown chunker for the interview corpus index.
//
// Strategy (lifted from voc-rag-chat's chunkFile + tuned for interview
// transcripts):
//   1. Walk markdown line-by-line, maintaining the current heading path
//      (`## Q. ...` → `['Q. ...']`, with deeper levels nesting).
//   2. Treat each headed section as a candidate chunk.
//   3. Split long sections by paragraph and regroup to ~MAX_CHARS so the
//      embedding API doesn't see >8k-token inputs.
//   4. Detect speaker-labeled lines (`A: …`, `응답자: …`, `Q. …`) and
//      split them out as is_quote chunks. PR-2 chat surface will rank
//      quote chunks higher when the user asks "show me what people said".
//
// Tokenizer is cheap (~4 chars per token). text-embedding-3-small caps
// at 8191 tokens; we keep MAX_CHARS well under that for both safety and
// retrieval granularity.

const MAX_CHARS = 1800;
const MIN_CHARS = 40; // drop chunks shorter than this — usually noise
const OVERLAP_CHARS = 200;

export type InterviewChunkMetadata = {
  filename: string;
  heading_path: string[];
  paragraph_index: number;
  char_start: number;
  char_end: number;
  is_quote: boolean;
  token_estimate: number;
};

export type InterviewChunk = {
  content: string;
  metadata: InterviewChunkMetadata;
};

// Heading regex captures level (1-6) and the trimmed title text.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

// Speaker labels we treat as verbatim quote markers. The trailing space
// after the colon is required so URLs ("https:") don't false-match.
//
// English: A:, Q:, R:, Interviewer:, Respondent:
// Korean : 응답자:, 질문자:, 인터뷰어:, 답변:
const SPEAKER_RE =
  /^(A|Q|R|Interviewer|Respondent|모더레이터|인터뷰어|질문자|응답자|답변)\s*[:：]\s+/i;

type Section = {
  headingPath: string[];
  body: string;
  charStart: number;
};

function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let buf: string[] = [];
  let bufStart = 0;
  let cursor = 0;

  // Flushes the accumulated body under the current heading stack.
  const flush = (atOffset: number) => {
    const body = buf.join('\n');
    if (body.trim().length > 0) {
      sections.push({
        headingPath: stack.map((s) => s.text),
        body,
        charStart: bufStart,
      });
    }
    buf = [];
    bufStart = atOffset;
  };

  const lines = markdown.split('\n');
  for (const line of lines) {
    const lineLen = line.length + 1; // include the newline
    const m = HEADING_RE.exec(line);
    if (m) {
      // Heading boundary — close out the current section first.
      flush(cursor);
      const level = m[1].length;
      const text = m[2].trim();
      // Pop deeper-or-equal headings off the stack so the path always
      // reflects the new heading's ancestry.
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, text });
      bufStart = cursor + lineLen;
    } else {
      buf.push(line);
    }
    cursor += lineLen;
  }
  flush(cursor);
  return sections;
}

// Estimate token count for an OpenAI input. Embedding API enforces an
// 8191-token cap per item; staying well under that keeps the chunk-level
// granularity useful for retrieval.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Pull out speaker-labeled lines as standalone quote chunks. Returns the
// quote chunks plus the residual paragraphs with the quotes removed (the
// residual becomes the section's body for normal paragraph chunking).
function extractQuotes(
  body: string,
  meta: Omit<InterviewChunkMetadata, 'paragraph_index' | 'char_start' | 'char_end' | 'is_quote' | 'token_estimate'>,
  sectionCharStart: number,
): { quotes: InterviewChunk[]; residual: string } {
  const quotes: InterviewChunk[] = [];
  const residualLines: string[] = [];
  // Treat consecutive speaker-labeled lines as one quote — a long answer
  // often spills onto subsequent lines without a label.
  let pendingQuote: { lines: string[]; startOffset: number } | null = null;
  let runningOffset = sectionCharStart;
  let paraIdx = 0;

  const closePending = () => {
    if (!pendingQuote) return;
    const text = pendingQuote.lines.join('\n').trim();
    if (text.length >= MIN_CHARS) {
      quotes.push({
        content: text,
        metadata: {
          ...meta,
          paragraph_index: paraIdx,
          char_start: pendingQuote.startOffset,
          char_end: pendingQuote.startOffset + text.length,
          is_quote: true,
          token_estimate: estimateTokens(text),
        },
      });
      paraIdx += 1;
    }
    pendingQuote = null;
  };

  const lines = body.split('\n');
  for (const line of lines) {
    const lineLen = line.length + 1;
    const trimmed = line.trim();
    if (SPEAKER_RE.test(trimmed)) {
      closePending();
      pendingQuote = {
        lines: [line],
        startOffset: runningOffset,
      };
    } else if (pendingQuote && trimmed.length > 0) {
      // Continuation of the current quote — keep accumulating until a
      // blank line or another speaker label arrives.
      pendingQuote.lines.push(line);
    } else if (pendingQuote && trimmed.length === 0) {
      closePending();
      residualLines.push(line);
    } else {
      residualLines.push(line);
    }
    runningOffset += lineLen;
  }
  closePending();

  return { quotes, residual: residualLines.join('\n') };
}

// Group paragraphs (separated by blank lines) into chunks of ~MAX_CHARS,
// with OVERLAP_CHARS-worth of trailing context carried into the next
// chunk so a paragraph straddling the boundary stays retrievable.
function chunkParagraphs(
  text: string,
  meta: Omit<InterviewChunkMetadata, 'paragraph_index' | 'char_start' | 'char_end' | 'is_quote' | 'token_estimate'>,
  sectionCharStart: number,
  startParaIdx: number,
): InterviewChunk[] {
  const out: InterviewChunk[] = [];
  const paragraphs = text.split(/\n\s*\n/);

  let buf = '';
  let bufStart = sectionCharStart;
  let cursor = sectionCharStart;
  let paraIdx = startParaIdx;

  const push = (content: string, start: number) => {
    const trimmed = content.trim();
    if (trimmed.length < MIN_CHARS) return;
    out.push({
      content: trimmed,
      metadata: {
        ...meta,
        paragraph_index: paraIdx,
        char_start: start,
        char_end: start + trimmed.length,
        is_quote: false,
        token_estimate: estimateTokens(trimmed),
      },
    });
    paraIdx += 1;
  };

  for (const p of paragraphs) {
    const candidate = buf ? buf + '\n\n' + p : p;
    if (candidate.length > MAX_CHARS && buf) {
      push(buf, bufStart);
      // Preserve the trailing OVERLAP_CHARS of the just-flushed buffer
      // so the next chunk can still see the bridging context.
      const overlapText = buf.slice(-OVERLAP_CHARS);
      const overlapLen = overlapText.length;
      buf = overlapText + '\n\n' + p;
      bufStart = cursor - overlapLen;
    } else {
      buf = candidate;
    }
    cursor += p.length + 2; // approximate the blank-line separator
  }
  if (buf.trim().length > 0) push(buf, bufStart);
  return out;
}

export function chunkMarkdown(
  markdown: string,
  opts: { filename: string },
): InterviewChunk[] {
  if (!markdown || markdown.trim().length === 0) return [];
  const sections = splitSections(markdown);
  if (sections.length === 0) {
    // No headings at all — treat the whole document as one section
    // anchored at the file root.
    sections.push({ headingPath: [], body: markdown, charStart: 0 });
  }

  const out: InterviewChunk[] = [];
  for (const section of sections) {
    const baseMeta = {
      filename: opts.filename,
      heading_path: section.headingPath,
    };
    const { quotes, residual } = extractQuotes(
      section.body,
      baseMeta,
      section.charStart,
    );
    out.push(...quotes);
    const residualChunks = chunkParagraphs(
      residual,
      baseMeta,
      section.charStart,
      quotes.length,
    );
    out.push(...residualChunks);
  }
  return out;
}
