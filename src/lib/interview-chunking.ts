// Q&A-aware markdown chunker for the interview corpus index.
//
// Two-mode strategy:
//
//   1. Q&A-pair mode (interview transcripts with question/answer labels):
//      pair each question with the answer(s) that follow it into ONE chunk
//      so the embedding always carries the question context. Long answers
//      are contextual-split (Anthropic Contextual Retrieval): each sub-chunk
//      is prefixed with the question so it stays self-contained after the
//      cut. Short answers ("네"/"아니오") are absorbed into the pair — never
//      dropped as MIN_CHARS noise.
//
//   2. Legacy section/paragraph mode (free-form narrative transcripts that
//      have no Q&A labels): the original heading-aware paragraph chunker,
//      unchanged — no regression for docs that were never Q&A.
//
// The document as a whole is classified once (isQaDocument) and routed to
// exactly one mode. Anything the Q&A pass can't attach to a pair (preamble,
// orphan answers) is still fed through the paragraph chunker so nothing is
// lost.
//
// Tokenizer is cheap (~4 chars per token). text-embedding-3-small caps at
// 8191 tokens; we keep MAX_CHARS well under that for both safety and
// retrieval granularity.

// Bump when the chunking logic changes materially. Stamped into every
// chunk's metadata so a search/topline consumer — or a re-index decision —
// can tell which chunker produced a given row. New uploads always run the
// current version; existing documents are only re-chunked on an explicit
// re-index (see /api/interviews/index/run-now), so a bump never silently
// triggers a costly org-wide re-embed.
export const CHUNK_VERSION = 2;

const MAX_CHARS = 1800;
const MIN_CHARS = 40; // drop residual chunks shorter than this — usually noise
const OVERLAP_CHARS = 200;
// When a long answer is contextual-split, each sub-chunk is prefixed with
// the question. Cap the prefix so a runaway question doesn't crowd out the
// answer content in a sub-chunk.
const CONTEXT_PREFIX_CHARS = 400;

export type InterviewChunkMetadata = {
  filename: string;
  heading_path: string[];
  paragraph_index: number;
  char_start: number;
  char_end: number;
  is_quote: boolean;
  token_estimate: number;
  // Chunking-strategy version — see CHUNK_VERSION.
  chunk_version: number;
  // Q&A-pair extensions. Present on every chunk; the fields are null/false
  // for legacy (non-Q&A) chunks so consumers can read them unconditionally.
  is_qa_pair: boolean;
  question: string | null;
  respondent_role: string | null;
  section: string | null;
  doc_id: string | null;
};

export type InterviewChunk = {
  content: string;
  metadata: InterviewChunkMetadata;
};

// Fields shared by every chunk of a document, threaded through the helpers.
type BaseMeta = {
  filename: string;
  heading_path: string[];
  section: string | null;
  doc_id: string | null;
};

// Heading regex captures level (1-6) and the trimmed title text.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

// Speaker labels, split by conversational role.
//
// Questioner  : Q, 질문, 질문자, 모더레이터, 인터뷰어, Interviewer, Moderator
// Answerer    : A, R, 답변, 답변자, 응답자, Respondent
//
// A separator ([.:：]) after the label is required so "https:" and prose like
// "A number of…" don't false-match (the label must be immediately followed
// by a separator, not more letters). An optional index ("Q3", "질문 2") is
// allowed between the label and the separator.
const QUESTIONER_INLINE_RE =
  /^\s*(Q|질문자|질문|모더레이터|인터뷰어|Interviewer|Moderator)\s*\d*\s*[.:：]\s*/i;
const ANSWERER_INLINE_RE =
  /^\s*(A|R|답변자|답변|응답자|Respondent)\s*\d*\s*[.:：]\s*/i;
// A heading that is itself a question, e.g. "## Q3. 광고 경험" or
// "## 질문 2: …". Separator required to avoid matching prose headings
// like "질문지 검토".
const QUESTION_HEADING_RE = /^(Q|질문)\s*\d*\s*[.:：]/i;

// Legacy speaker matcher — retained for the non-Q&A paragraph path so a
// stray labeled line in a narrative transcript is still surfaced as a quote.
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

// Hard per-chunk token ceiling for OpenAI embeddings. text-embedding-3-small
// caps at 8191 tokens/input; we split well under that (safety margin for
// estimate error) so a single wide CSV row can never fail the whole file's
// indexing with `400 maximum input length is 8192 tokens`.
export const MAX_EMBED_TOKENS = 7000;

// True for CJK codepoints (Hangul, Kana, Han, and fullwidth forms). These
// tokenize far denser than Latin text under OpenAI's cl100k_base.
function isCjk(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0x3000 && code <= 0x30ff) || // CJK symbols/punct, Hiragana, Katakana
    (code >= 0x3130 && code <= 0x318f) || // Hangul Compatibility Jamo
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Ext A
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0xff00 && code <= 0xffef) //   Halfwidth/Fullwidth forms
  );
}

// Conservative token estimate for the embedding-cap guard. The cheap char/4
// heuristic (estimateTokens) is tuned for Latin text and badly UNDER-counts
// CJK: Korean/Japanese/Chinese routinely tokenize to ~1-2 tokens PER character
// under cl100k_base. Wide Korean screener/crosstab CSVs are exactly what
// tripped the 8192-token embedding cap. We weight CJK codepoints at 2 tokens
// each and the rest at 1 token / 4 chars, deliberately over-estimating so we
// never under-split and trigger a 400. (Spec: 토큰 추정은 보수적으로 — 과소추정 금지.)
export function conservativeTokenEstimate(text: string): number {
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (isCjk(ch.codePointAt(0)!)) cjk += 1;
  }
  return Math.ceil(cjk * 2 + (total - cjk) / 4);
}

// Split text so every part is within `maxTokens` (conservative estimate).
// Prefers breaking at a natural delimiter (newline, CSV comma/tab/pipe, or
// space) in the back half of the window so a wide CSV row splits on column
// boundaries rather than mid-value; falls back to a hard char cut when no
// delimiter is near.
export function splitToTokenCap(text: string, maxTokens: number): string[] {
  if (conservativeTokenEstimate(text) <= maxTokens) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (conservativeTokenEstimate(rest) <= maxTokens) {
      parts.push(rest);
      break;
    }
    // Largest prefix (by char length) that fits the token budget.
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (conservativeTokenEstimate(rest.slice(0, mid)) <= maxTokens) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    // Prefer a delimiter in the back half of the window to keep columns whole.
    const window = rest.slice(0, cut);
    const delim = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('\t'),
      window.lastIndexOf(','),
      window.lastIndexOf('|'),
      window.lastIndexOf(' '),
    );
    if (delim >= cut * 0.5) cut = delim + 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return parts.filter((p) => p.length > 0);
}

// Last-resort truncation to the token cap — returns the safe leading prefix.
// Used by the embedding guard so a stray over-cap input degrades to a
// truncated embedding instead of failing the batch (and the whole file).
export function truncateToTokenCap(
  text: string,
  maxTokens: number = MAX_EMBED_TOKENS,
): string {
  const parts = splitToTokenCap(text, maxTokens);
  return parts.length > 0 ? parts[0] : text;
}

// Final safety net: whichever mode produced a chunk, guarantee none exceeds
// the embedding token cap. Over-cap chunks (a wide CSV row that landed as a
// single paragraph, or CJK-dense content the char/4 estimate under-counted)
// are split on column/char boundaries, with metadata char offsets and
// token_estimate recomputed per part.
function enforceTokenCap(chunks: InterviewChunk[]): InterviewChunk[] {
  const out: InterviewChunk[] = [];
  for (const chunk of chunks) {
    if (conservativeTokenEstimate(chunk.content) <= MAX_EMBED_TOKENS) {
      out.push(chunk);
      continue;
    }
    const parts = splitToTokenCap(chunk.content, MAX_EMBED_TOKENS);
    let offset = 0;
    for (const part of parts) {
      const content = part.trim();
      if (content.length === 0) {
        offset += part.length;
        continue;
      }
      out.push({
        content,
        metadata: {
          ...chunk.metadata,
          char_start: chunk.metadata.char_start + offset,
          char_end: chunk.metadata.char_start + offset + content.length,
          token_estimate: estimateTokens(content),
        },
      });
      offset += part.length;
    }
  }
  return out;
}

function sectionOf(headingPath: string[]): string | null {
  return headingPath.length > 0 ? headingPath[headingPath.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Q&A-pair mode
// ---------------------------------------------------------------------------

type QaPair = {
  question: string;
  answer: string;
  respondentRole: string | null;
  headingPath: string[];
  charStart: number;
};

// Walk the document once, pairing each question with the answer text that
// follows it (until the next question). Questions come from inline labels
// ("Q: …") or question-style headings ("## Q3. …"); answers come from
// answerer labels ("A: …", "응답자: …") or, when unlabeled, the plain text
// that sits between a question and the next boundary. Text that precedes the
// first question (or trails as an orphan) is returned separately so the
// caller can still chunk it — nothing is discarded.
function buildQaPairs(markdown: string): {
  pairs: QaPair[];
  preamble: { text: string; charStart: number }[];
} {
  const pairs: QaPair[] = [];
  const preamble: { text: string; charStart: number }[] = [];
  const stack: { level: number; text: string }[] = [];

  let cursor = 0;
  let current: QaPair | null = null;
  let answerLines: string[] = [];
  let orphanLines: string[] = [];
  let orphanStart = 0;

  const flushPair = () => {
    if (!current) return;
    current.answer = answerLines.join('\n').trim();
    pairs.push(current);
    current = null;
    answerLines = [];
  };

  const flushOrphan = () => {
    const text = orphanLines.join('\n');
    if (text.trim().length > 0) {
      preamble.push({ text, charStart: orphanStart });
    }
    orphanLines = [];
  };

  const startQuestion = (questionText: string, charStart: number) => {
    flushPair();
    flushOrphan();
    current = {
      question: questionText.trim(),
      answer: '',
      respondentRole: null,
      headingPath: stack.map((s) => s.text),
      charStart,
    };
    answerLines = [];
  };

  const lines = markdown.split('\n');
  for (const line of lines) {
    const lineLen = line.length + 1;
    const lineStart = cursor;
    cursor += lineLen;

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, text });
      if (QUESTION_HEADING_RE.test(text)) {
        // The heading itself is the question; its body is the answer.
        startQuestion(text.replace(QUESTION_HEADING_RE, '').trim() || text, lineStart);
      } else {
        // A non-question heading ends the current pair (topic boundary).
        flushPair();
      }
      continue;
    }

    const qMatch = QUESTIONER_INLINE_RE.exec(line);
    if (qMatch) {
      startQuestion(line.slice(qMatch[0].length), lineStart);
      continue;
    }

    const aMatch = ANSWERER_INLINE_RE.exec(line);
    if (aMatch) {
      // Cast (not assign) so TS control-flow doesn't carry the initializer's
      // `null` narrowing — `current` is mutated inside closures, so its real
      // type here is the union, not `never`.
      const cur = current as QaPair | null;
      if (cur) {
        if (cur.respondentRole == null) {
          cur.respondentRole = aMatch[1].trim();
        }
        answerLines.push(line.slice(aMatch[0].length));
      } else {
        if (orphanLines.length === 0) orphanStart = lineStart;
        orphanLines.push(line);
      }
      continue;
    }

    // Unlabeled line.
    if (current) {
      // Continuation of the answer (or blank line inside a multi-para answer).
      answerLines.push(line);
    } else {
      if (orphanLines.length === 0) orphanStart = lineStart;
      orphanLines.push(line);
    }
  }
  flushPair();
  flushOrphan();

  return { pairs, preamble };
}

// A document is treated as Q&A when the pairing pass produced at least two
// questions that actually have answer text. This is deliberately
// conservative: a lone stray "A:" in a narrative transcript won't flip the
// whole document into pair mode (which would regress free-form chunking).
function isQaDocument(pairs: QaPair[]): boolean {
  const answered = pairs.filter((p) => p.answer.trim().length > 0).length;
  return answered >= 2;
}

// Emit a Q&A pair as one or more chunks. The question is always prepended to
// the content so the embedding carries it. If Q+A fits under MAX_CHARS it is
// a single chunk; otherwise the answer is contextual-split into sub-chunks,
// each re-prefixed with the (possibly truncated) question so it stays
// self-contained.
function chunkQaPair(
  pair: QaPair,
  base: BaseMeta,
  startParaIdx: number,
): { chunks: InterviewChunk[]; nextParaIdx: number } {
  const chunks: InterviewChunk[] = [];
  let paraIdx = startParaIdx;
  const question = pair.question;
  const answer = pair.answer;

  const makeChunk = (content: string, charStart: number) => {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    chunks.push({
      content: trimmed,
      metadata: {
        filename: base.filename,
        heading_path: base.heading_path,
        section: base.section,
        doc_id: base.doc_id,
        paragraph_index: paraIdx,
        char_start: charStart,
        char_end: charStart + trimmed.length,
        is_quote: true,
        token_estimate: estimateTokens(trimmed),
        chunk_version: CHUNK_VERSION,
        is_qa_pair: true,
        question: question || null,
        respondent_role: pair.respondentRole,
      },
    });
    paraIdx += 1;
  };

  const whole = question ? `${question}\n${answer}`.trim() : answer.trim();

  if (whole.length <= MAX_CHARS || answer.trim().length === 0) {
    // Fits (or there's no answer to split) — one chunk. Short answers like
    // "네" ride along with the question here and are never dropped.
    makeChunk(whole, pair.charStart);
    return { chunks, nextParaIdx: paraIdx };
  }

  // Long answer → contextual split. Prefix each sub-chunk with the question.
  const prefix =
    question.length > CONTEXT_PREFIX_CHARS
      ? question.slice(0, CONTEXT_PREFIX_CHARS).trim()
      : question;
  const budget = Math.max(200, MAX_CHARS - prefix.length - 1);
  const paragraphs = answer.split(/\n\s*\n/);

  let buf = '';
  const flushBuf = () => {
    if (buf.trim().length === 0) return;
    makeChunk(prefix ? `${prefix}\n${buf.trim()}` : buf.trim(), pair.charStart);
    buf = '';
  };
  for (const p of paragraphs) {
    const candidate = buf ? buf + '\n\n' + p : p;
    if (candidate.length > budget && buf) {
      flushBuf();
      // Carry a little trailing context into the next sub-chunk.
      const overlap = buf.slice(-OVERLAP_CHARS);
      buf = overlap ? overlap + '\n\n' + p : p;
    } else if (candidate.length > budget) {
      // Single paragraph already over budget — hard-split on char boundary.
      let rest = p;
      while (rest.length > budget) {
        buf = rest.slice(0, budget);
        flushBuf();
        rest = rest.slice(budget);
      }
      buf = rest;
    } else {
      buf = candidate;
    }
  }
  flushBuf();

  return { chunks, nextParaIdx: paraIdx };
}

// ---------------------------------------------------------------------------
// Legacy section/paragraph mode (unchanged behavior for non-Q&A docs)
// ---------------------------------------------------------------------------

// Pull out speaker-labeled lines as standalone quote chunks. Returns the
// quote chunks plus the residual paragraphs with the quotes removed.
function extractQuotes(
  body: string,
  base: BaseMeta,
  sectionCharStart: number,
): { quotes: InterviewChunk[]; residual: string } {
  const quotes: InterviewChunk[] = [];
  const residualLines: string[] = [];
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
          filename: base.filename,
          heading_path: base.heading_path,
          section: base.section,
          doc_id: base.doc_id,
          paragraph_index: paraIdx,
          char_start: pendingQuote.startOffset,
          char_end: pendingQuote.startOffset + text.length,
          is_quote: true,
          token_estimate: estimateTokens(text),
          chunk_version: CHUNK_VERSION,
          is_qa_pair: false,
          question: null,
          respondent_role: null,
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
// with OVERLAP_CHARS-worth of trailing context carried into the next chunk.
function chunkParagraphs(
  text: string,
  base: BaseMeta,
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
        filename: base.filename,
        heading_path: base.heading_path,
        section: base.section,
        doc_id: base.doc_id,
        paragraph_index: paraIdx,
        char_start: start,
        char_end: start + trimmed.length,
        is_quote: false,
        token_estimate: estimateTokens(trimmed),
        chunk_version: CHUNK_VERSION,
        is_qa_pair: false,
        question: null,
        respondent_role: null,
      },
    });
    paraIdx += 1;
  };

  for (const p of paragraphs) {
    const candidate = buf ? buf + '\n\n' + p : p;
    if (candidate.length > MAX_CHARS && buf) {
      push(buf, bufStart);
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

function chunkLegacy(
  markdown: string,
  base: { filename: string; doc_id: string | null },
): InterviewChunk[] {
  const sections = splitSections(markdown);
  if (sections.length === 0) {
    sections.push({ headingPath: [], body: markdown, charStart: 0 });
  }

  const out: InterviewChunk[] = [];
  for (const section of sections) {
    const sectionBase: BaseMeta = {
      filename: base.filename,
      heading_path: section.headingPath,
      section: sectionOf(section.headingPath),
      doc_id: base.doc_id,
    };
    const { quotes, residual } = extractQuotes(
      section.body,
      sectionBase,
      section.charStart,
    );
    out.push(...quotes);
    out.push(
      ...chunkParagraphs(residual, sectionBase, section.charStart, quotes.length),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------

export function chunkMarkdown(
  markdown: string,
  opts: { filename: string; docId?: string | null },
): InterviewChunk[] {
  if (!markdown || markdown.trim().length === 0) return [];

  const docId = opts.docId ?? null;
  const { pairs, preamble } = buildQaPairs(markdown);

  if (!isQaDocument(pairs)) {
    // Free-form transcript — original heading/paragraph chunker, no regression.
    // Token cap still applies: a wide CSV with no blank-line boundaries lands
    // here as one giant paragraph, so the safety net splits it.
    return enforceTokenCap(
      chunkLegacy(markdown, { filename: opts.filename, doc_id: docId }),
    );
  }

  const out: InterviewChunk[] = [];
  let paraIdx = 0;

  // Preamble / orphan text (title, intro, answers before the first question)
  // still gets chunked so nothing is lost. It carries no Q&A metadata.
  for (const p of preamble) {
    const base: BaseMeta = {
      filename: opts.filename,
      heading_path: [],
      section: null,
      doc_id: docId,
    };
    const chunks = chunkParagraphs(p.text, base, p.charStart, paraIdx);
    out.push(...chunks);
    paraIdx += chunks.length;
  }

  for (const pair of pairs) {
    if (pair.question.trim().length === 0 && pair.answer.trim().length === 0) {
      continue;
    }
    const base: BaseMeta = {
      filename: opts.filename,
      heading_path: pair.headingPath,
      section: sectionOf(pair.headingPath),
      doc_id: docId,
    };
    const { chunks, nextParaIdx } = chunkQaPair(pair, base, paraIdx);
    out.push(...chunks);
    paraIdx = nextParaIdx;
  }

  return enforceTokenCap(out);
}
