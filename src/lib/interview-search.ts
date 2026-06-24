// pgvector retrieval for the interview corpus chat (PR-2).
//
// The flow: embed the user's natural-language question via OpenAI's
// text-embedding-3-small (same model used at index time), then call the
// match_interview_chunks RPC to pull the top-K cosine-nearest chunks
// scoped to a single interview_job_id. The chat route turns the result
// into a system-prompt evidence block and a citations envelope.

import OpenAI from 'openai';

const EMBED_MODEL = 'text-embedding-3-small';

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export type InterviewSearchHit = {
  chunk_id: number;
  document_id: string;
  content: string;
  similarity: number;
  filename: string;
  // Reconstructed `## Q. …` ancestry from the heading-aware chunker.
  // Empty array for chunks that lived directly under the document root.
  heading_path: string[];
  is_quote: boolean;
};

// Minimal admin-client shape — typed against the structural surface we
// actually call so the lib doesn't have to import @supabase/supabase-js.
// `rpc(...)` returns a PostgrestFilterBuilder, which is a thenable (not
// a real Promise) — `await rpc(...)` resolves to `{ data, error }`, so
// the return is typed as `PromiseLike` to match either shape.
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
 * Top-K cosine retrieval for the chat surface.
 *
 * The route is expected to have already verified that `jobId` belongs to
 * an org the requester can see — this function just embeds + queries.
 * Pass the admin client (created in the route) so the search bypasses
 * RLS for retrieval performance. Authorization happens at the route
 * boundary, not here.
 */
export async function searchChunks(opts: {
  client: RpcClient;
  jobId: string;
  query: string;
  k?: number;
}): Promise<InterviewSearchHit[]> {
  const { client: db, jobId, query, k = 12 } = opts;
  if (!query.trim()) return [];
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('missing_openai_api_key');
  }

  // Embed the query. The chat surface fires one search per user turn,
  // so we don't bother batching — single-input embedding is the common
  // case and OpenAI handles it without retries.
  const res = await client().embeddings.create({
    model: EMBED_MODEL,
    input: query,
  });
  const vec = res.data[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error('embedding_failed');
  }

  // pgvector accepts a string literal cast to vector. Sending an array
  // through the Supabase JS client works but doubles the request size
  // (every float becomes a JSON number with full precision).
  const rpcRes = await db.rpc('match_interview_chunks', {
    query_embedding: toVectorLiteral(vec),
    job_id: jobId,
    match_count: k,
  });
  if (rpcRes.error) {
    const msg =
      typeof rpcRes.error === 'object' && rpcRes.error && 'message' in rpcRes.error
        ? String((rpcRes.error as { message: unknown }).message)
        : 'rpc_error';
    throw new Error(`match_interview_chunks: ${msg}`);
  }

  type RpcRow = {
    chunk_id: number | string;
    document_id: string;
    content: string;
    metadata: { filename?: string; heading_path?: string[]; is_quote?: boolean } | null;
    similarity: number;
  };
  const rows = (Array.isArray(rpcRes.data) ? rpcRes.data : []) as RpcRow[];

  return rows.map((r) => {
    const meta = r.metadata ?? {};
    return {
      chunk_id: typeof r.chunk_id === 'string' ? Number(r.chunk_id) : r.chunk_id,
      document_id: r.document_id,
      content: r.content,
      similarity: r.similarity,
      filename: typeof meta.filename === 'string' ? meta.filename : '',
      heading_path: Array.isArray(meta.heading_path) ? meta.heading_path : [],
      is_quote: meta.is_quote === true,
    };
  });
}

// Citation payload persisted alongside each assistant message. The
// front-end re-renders **근거** bibliographies from this without needing
// to refetch chunks, so keep it self-contained.
export type ChatCitation = {
  document_id: string;
  chunk_id: number;
  filename: string;
  heading_path: string[];
};

export function hitToCitation(hit: InterviewSearchHit): ChatCitation {
  return {
    document_id: hit.document_id,
    chunk_id: hit.chunk_id,
    filename: hit.filename,
    heading_path: hit.heading_path,
  };
}
