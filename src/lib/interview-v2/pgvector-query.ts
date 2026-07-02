// Interview V2 pgvector retrieval.
//
// Embeds a natural-language question with OpenAI text-embedding-3-small
// (the same model used at index time — src/lib/interview-embed.ts) and
// calls the match_interview_chunks_v2 RPC (migration 20260702083923) to
// pull the top-K cosine-nearest chunks across a project (or the whole org
// when projectId is null), already filtered by the similarity floor.
//
// Authorization happens at the route boundary (getActiveOrg → org_id);
// this helper just embeds + queries. Mirrors src/lib/interview-search.ts.

import OpenAI from 'openai';
import { env } from '@/env';

const EMBED_MODEL = 'text-embedding-3-small';

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _client;
}

export type InterviewV2Hit = {
  chunk_id: number;
  document_id: string;
  content: string;
  filename: string;
  project_id: string | null;
  project_name: string | null;
  score: number;
};

// Minimal admin-client shape — typed against the structural surface we
// call so the lib doesn't import @supabase/supabase-js. `rpc(...)` returns
// a thenable resolving to `{ data, error }`.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

function toVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}

/**
 * Top-K cosine retrieval for the V2 search surface.
 *
 * @param orgId   Requester's active org — the isolation boundary.
 * @param projectId  Narrow to one interview_documents.project_id, or null
 *                   for a cross-project (org-wide) search.
 * @param scoreThreshold  Cosine-similarity floor (default 0.7). Chunks
 *                   below this are dropped inside the RPC.
 */
export async function searchInterviewV2Chunks(opts: {
  client: RpcClient;
  orgId: string;
  projectId?: string | null;
  query: string;
  k?: number;
  scoreThreshold?: number;
}): Promise<InterviewV2Hit[]> {
  const {
    client: db,
    orgId,
    projectId = null,
    query,
    k = 12,
    scoreThreshold = 0.7,
  } = opts;
  if (!query.trim()) return [];
  if (!env.OPENAI_API_KEY) {
    throw new Error('missing_openai_api_key');
  }

  const res = await client().embeddings.create({
    model: EMBED_MODEL,
    input: query,
  });
  const vec = res.data[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error('embedding_failed');
  }

  const rpcRes = await db.rpc('match_interview_chunks_v2', {
    query_embedding: toVectorLiteral(vec),
    p_org_id: orgId,
    p_project_id: projectId,
    match_count: k,
    score_threshold: scoreThreshold,
  });
  if (rpcRes.error) {
    const msg =
      typeof rpcRes.error === 'object' && rpcRes.error && 'message' in rpcRes.error
        ? String((rpcRes.error as { message: unknown }).message)
        : 'rpc_error';
    throw new Error(`match_interview_chunks_v2: ${msg}`);
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
