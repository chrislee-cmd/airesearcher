// Interview V2 search — client-side stream parser.
//
// The search route streams the Sonnet answer via
// `streamObject(...).toTextStreamResponse()`, whose body is the *partial
// JSON text* of the { answer_md, citations, no_answer } object being built.
// We accumulate the decoded text and re-parse it on every chunk with the AI
// SDK's `parsePartialJson` (tolerant of half-written JSON), yielding a
// best-effort snapshot of the object so the UI can re-render the growing
// markdown answer live.
//
// The no_answer / error branches of the route return a plain
// `application/json` body instead of a stream — the caller branches on
// content-type and only feeds the streamed path here.

import { parsePartialJson } from 'ai';
import type { Citation } from '@/lib/interview-v2/types';

export type SearchStreamPartial = {
  answer_md: string;
  citations: Citation[];
  no_answer: boolean;
};

function coerceCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const out: Citation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.chunk_id !== 'string' && typeof c.chunk_id !== 'number') continue;
    out.push({
      chunk_id: String(c.chunk_id),
      document_id: typeof c.document_id === 'string' ? c.document_id : '',
      filename: typeof c.filename === 'string' ? c.filename : '',
      project_name:
        typeof c.project_name === 'string' ? c.project_name : undefined,
      excerpt: typeof c.excerpt === 'string' ? c.excerpt : '',
      score: typeof c.score === 'number' ? c.score : 0,
    });
  }
  return out;
}

// Turn accumulated (possibly incomplete) JSON text into a snapshot, or null
// when there isn't enough yet to parse even partially.
async function snapshot(text: string): Promise<SearchStreamPartial | null> {
  const { value, state } = await parsePartialJson(text);
  if (state === 'failed-parse' || state === 'undefined-input') return null;
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    answer_md: typeof obj.answer_md === 'string' ? obj.answer_md : '',
    citations: coerceCitations(obj.citations),
    no_answer: obj.no_answer === true,
  };
}

/**
 * Consume the search route's streamed body, yielding a progressively more
 * complete { answer_md, citations, no_answer } snapshot on each chunk. The
 * final yield reflects the fully-received object.
 */
export async function* parseSearchStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SearchStreamPartial, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let acc = '';
  let last: SearchStreamPartial | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    const snap = await snapshot(acc);
    if (snap) {
      last = snap;
      yield snap;
    }
  }

  // Flush any trailing buffered bytes and emit a final authoritative snapshot.
  acc += decoder.decode();
  const final = await snapshot(acc);
  if (final) yield final;
  else if (last) yield last;
}
