// Interview V2 keyword (trigram) retrieval — the keyword half of hybrid search.
//
// Companion to pgvector-query.ts. Where the vector path embeds the question
// and ranks by cosine similarity, this path tokenizes the question and ranks
// chunks by how many of those tokens appear verbatim (per-term ILIKE over the
// pg_trgm GIN index). It exists to recover exact tokens — proper nouns,
// numbers, brands — that cross-lingual cosine similarity structurally misses
// (see migration 20260707060333 + PROJECT.md §7.13).
//
// Returns the identical InterviewV2Hit shape as the vector path so the route
// can RRF-fuse both ranked lists by chunk_id without shape gymnastics. `score`
// here is the 0..1 term-coverage ratio from the RPC (fraction of query terms
// present), not a cosine score — the fusion uses rank, not raw score.

import type { InterviewV2Hit } from '@/lib/interview-v2/pgvector-query';

// Minimal admin-client shape — same structural contract as pgvector-query.ts.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

// Tokens shorter than this are dropped — single characters (Latin) match far
// too broadly through a substring index to be useful signal. Korean is left
// at ≥2 too: a lone syllable is rarely a discriminating keyword, and the
// vector half already covers semantic recall. Cap the term count so a very
// long question can't fan out into a huge OR-of-ILIKE scan.
const MIN_TERM_LEN = 2;
const MAX_TERMS = 16;

/**
 * Tokenize a natural-language question into keyword search terms.
 *
 * Splits on any run of non-letter/non-number characters (Unicode-aware, so
 * Korean syllables and Latin words both survive; punctuation and whitespace
 * separate). Alphanumerics stay glued together so "SPF50" / "FSA" survive as
 * single exact tokens. Lowercased (ILIKE is case-insensitive anyway, but this
 * dedupes case variants), deduped, and capped.
 *
 * Exported for unit testing — the term set drives keyword recall.
 */
export function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TERM_LEN);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/**
 * Keyword retrieval over interview_chunks via the trigram RPC.
 *
 * Signature mirrors searchInterviewV2Chunks: projectIds present (not
 * undefined/null) ⇒ the _multi RPC; otherwise the single-project RPC. Returns
 * [] when the question yields no usable terms (all punctuation / too short) —
 * the caller then falls back to the vector ranking alone.
 */
export async function searchInterviewV2Keyword(opts: {
  client: RpcClient;
  orgId: string;
  projectId?: string | null;
  projectIds?: string[] | null;
  query: string;
  k?: number;
  // Single-document scope (file-detail search). Honored only on the
  // single-project path; null/undefined ⇒ no document narrowing.
  documentId?: string | null;
}): Promise<InterviewV2Hit[]> {
  const {
    client: db,
    orgId,
    projectId = null,
    projectIds,
    query,
    k = 12,
    documentId = null,
  } = opts;
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];

  const useMultiProject = projectIds !== undefined && projectIds !== null;
  const rpcName = useMultiProject
    ? 'match_interview_chunks_v2_keyword_multi'
    : 'match_interview_chunks_v2_keyword';
  const rpcArgs = useMultiProject
    ? {
        p_org_id: orgId,
        p_project_ids: projectIds,
        p_terms: terms,
        match_count: k,
      }
    : {
        p_org_id: orgId,
        p_project_id: projectId,
        p_terms: terms,
        match_count: k,
        // Only send p_document_id when scoping to a file — keeps the arg set
        // identical to the pre-migration signature so existing searches never
        // 500 if this ships before the migration is applied (no ordering hazard).
        ...(documentId ? { p_document_id: documentId } : {}),
      };

  const rpcRes = await db.rpc(rpcName, rpcArgs);
  if (rpcRes.error) {
    const msg =
      typeof rpcRes.error === 'object' && rpcRes.error && 'message' in rpcRes.error
        ? String((rpcRes.error as { message: unknown }).message)
        : 'rpc_error';
    throw new Error(`${rpcName}: ${msg}`);
  }

  type RpcRow = {
    chunk_id: number | string;
    document_id: string;
    content: string;
    filename: string | null;
    project_id: string | null;
    project_name: string | null;
    score: number;
  };
  const rows = (Array.isArray(rpcRes.data) ? rpcRes.data : []) as RpcRow[];

  return rows.map((r) => ({
    chunk_id: typeof r.chunk_id === 'string' ? Number(r.chunk_id) : r.chunk_id,
    document_id: r.document_id,
    content: r.content,
    filename: typeof r.filename === 'string' ? r.filename : '',
    project_id: r.project_id ?? null,
    project_name: r.project_name ?? null,
    score: r.score,
  }));
}
