// Interview V2 small-to-big — expand a matched chunk to its parent unit.
//
// Matching happens on SMALL chunks (precise: a long answer is contextual-split
// into ~1.8KB sub-chunks, each re-prefixed with its question — see
// interview-chunking.ts). But feeding a mid-answer fragment to the LLM loses
// the completeness of the evidence. small-to-big returns the WHOLE parent
// (the full Q&A pair) so the answer is grounded in un-truncated context.
//
// Reconstruction uses ONLY the metadata the A(chunking) PR already stamps —
// no re-index, no markdown re-parse:
//   * All sub-chunks of one Q&A pair share (document_id, metadata.char_start)
//     — chunkQaPair stamps every sub-chunk with the pair's start offset — and
//     the same metadata.question. That tuple is the parent key.
//   * Each sub-chunk's content is `<question-prefix>\n<answer segment>`, with
//     ~OVERLAP_CHARS of trailing context carried into the next segment. We
//     strip the repeated question prefix, overlap-dedupe the answer segments,
//     and prepend the question once.
//
// Non-Q&A (legacy paragraph / quote) chunks are already section-scoped and
// coherent, so they are returned unchanged — merging arbitrary section
// paragraphs risks stitching unrelated content. (Conservative scope: the spec
// names "Q&A 페어 or 섹션"; we expand the Q&A-pair case, which is where
// mid-answer truncation actually occurs.)

// The prefix cap used by the chunker when it re-prefixes a split answer
// (interview-chunking.ts CONTEXT_PREFIX_CHARS). Kept in sync manually — a
// change there without a bump here only degrades prefix stripping to a no-op
// (the question line would remain, harmless duplication), never corrupts text.
const CONTEXT_PREFIX_CHARS = 400;

// Upper bound on the suffix/prefix window we search for overlap between
// consecutive answer segments. The chunker carries OVERLAP_CHARS (200); we
// look a bit wider so a whole trailing paragraph that exceeds that still
// dedupes cleanly.
const MAX_OVERLAP_SCAN = 600;

export type ParentSibling = {
  chunk_id: number;
  content: string;
  metadata: {
    char_start?: number | null;
    question?: string | null;
    is_qa_pair?: boolean | null;
    paragraph_index?: number | null;
  } | null;
};

/**
 * Stable parent key for a chunk, or null when the chunk is its own parent
 * (non-Q&A, or a Q&A pair with no question / no char_start to group on).
 * Two chunks with the same non-null key belong to the same parent unit.
 */
export function parentKey(
  documentId: string,
  meta: ParentSibling['metadata'],
): string | null {
  if (!meta || meta.is_qa_pair !== true) return null;
  if (typeof meta.char_start !== 'number') return null;
  return `qa:${documentId}:${meta.char_start}`;
}

// Strip the leading question prefix the chunker prepended to a sub-chunk,
// returning just that sub-chunk's answer segment. The chunker uses the full
// question when ≤ CONTEXT_PREFIX_CHARS, else its first CONTEXT_PREFIX_CHARS.
function stripQuestionPrefix(content: string, question: string): string {
  if (!question) return content;
  const prefix =
    question.length > CONTEXT_PREFIX_CHARS
      ? question.slice(0, CONTEXT_PREFIX_CHARS)
      : question;
  if (content.startsWith(prefix + '\n')) {
    return content.slice(prefix.length + 1);
  }
  if (content === prefix) return '';
  return content;
}

// Append `b` to `a`, collapsing the largest overlap where a's suffix equals
// b's prefix (the chunker's carried context). Falls back to a paragraph break
// when there's no overlap.
function overlapAppend(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const max = Math.min(a.length, b.length, MAX_OVERLAP_SCAN);
  for (let o = max; o > 0; o--) {
    if (a.slice(a.length - o) === b.slice(0, o)) {
      return a + b.slice(o);
    }
  }
  return a + '\n\n' + b;
}

/**
 * Reconstruct a parent's full text from its sibling sub-chunks.
 *
 * Pure — takes the sibling set (any order) and returns the merged parent
 * content. For a Q&A pair: question + overlap-merged answer. A single-chunk
 * pair round-trips to its own content unchanged. Exported for unit testing.
 */
export function reconstructParent(siblings: ParentSibling[]): string {
  if (siblings.length === 0) return '';
  const ordered = [...siblings].sort((a, b) => {
    const pa = a.metadata?.paragraph_index ?? 0;
    const pb = b.metadata?.paragraph_index ?? 0;
    if (pa !== pb) return pa - pb;
    return a.chunk_id - b.chunk_id;
  });

  if (ordered.length === 1) return ordered[0].content;

  const question = ordered[0].metadata?.question ?? '';
  let merged = '';
  for (const s of ordered) {
    const answer = stripQuestionPrefix(s.content, question);
    merged = overlapAppend(merged, answer);
  }
  return question ? `${question}\n${merged}` : merged;
}

// ---------------------------------------------------------------------------
// DB orchestrator
// ---------------------------------------------------------------------------

// Loosely typed DB boundary. Structurally matching the full Supabase client's
// PostgrestFilterBuilder chain triggers TS2589 (excessively deep instantiation)
// because that builder is recursively generic — so `from` returns `any` and the
// `any` is confined to this one call. The row shape is validated at runtime
// below (mapped into ParentSibling).
type AdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase builder type is too deep to structurally match (TS2589); the `any` is localized to this DB boundary and rows are re-validated at runtime.
  from: (table: string) => any;
};

// Never fan out the sibling fetch across an unbounded document set — a hit
// list is already ≤ top_k, so its distinct docs are few, but cap defensively.
const MAX_PARENT_DOCS = 40;

type HitLike = { chunk_id: number; document_id: string; content: string };

/**
 * Expand ranked chunk hits to their parent units.
 *
 * Fetches every chunk for the documents present in `hits` (one bounded query),
 * groups siblings by parent key, and for each hit — in rank order — emits its
 * parent once (deduped: multiple hits from the same pair collapse to a single
 * complete parent). A hit whose chunk is its own parent (non-Q&A, or a pair we
 * can't group) passes through with its original content.
 *
 * Fail-open: any fetch error returns `hits` unchanged (parent expansion is an
 * evidence-quality enhancement, not a correctness gate).
 */
export async function expandHitsToParents<T extends HitLike>(
  admin: AdminClient,
  orgId: string,
  hits: T[],
): Promise<T[]> {
  if (hits.length === 0) return hits;

  const docIds = Array.from(new Set(hits.map((h) => h.document_id))).slice(
    0,
    MAX_PARENT_DOCS,
  );

  let rows: ParentSibling[] = [];
  try {
    const res = await admin
      .from('interview_chunks')
      .select('id, content, document_id, metadata')
      .eq('org_id', orgId)
      .in('document_id', docIds);
    if (res.error) throw new Error(String(res.error));
    const raw = (Array.isArray(res.data) ? res.data : []) as Array<{
      id: number | string;
      content: string;
      document_id: string;
      metadata: ParentSibling['metadata'];
    }>;
    rows = raw.map((r) => ({
      chunk_id: typeof r.id === 'string' ? Number(r.id) : r.id,
      content: r.content,
      metadata: r.metadata,
    }));
  } catch (e) {
    console.warn('[v2/search] parent expansion fetch failed — chunk-level fallback', e);
    return hits;
  }

  // chunk_id → its own row (for parent-key lookup), and parent key → siblings.
  const rowById = new Map<number, ParentSibling & { document_id: string }>();
  const siblingsByKey = new Map<string, ParentSibling[]>();
  for (const r of rows as Array<ParentSibling & { document_id: string }>) {
    rowById.set(r.chunk_id, r);
    const key = parentKey(r.document_id, r.metadata);
    if (!key) continue;
    const arr = siblingsByKey.get(key);
    if (arr) arr.push(r);
    else siblingsByKey.set(key, [r]);
  }

  const emittedParents = new Set<string>();
  const out: T[] = [];
  for (const hit of hits) {
    const row = rowById.get(hit.chunk_id);
    const key = row ? parentKey(hit.document_id, row.metadata) : null;
    if (!key) {
      // Own parent — pass through unchanged.
      out.push(hit);
      continue;
    }
    if (emittedParents.has(key)) continue; // sibling already contributed the parent
    emittedParents.add(key);
    const siblings = siblingsByKey.get(key) ?? [];
    const content = reconstructParent(siblings);
    out.push(content ? { ...hit, content } : hit);
  }
  return out;
}
