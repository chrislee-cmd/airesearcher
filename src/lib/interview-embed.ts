// Batched OpenAI embeddings for interview chunks.
//
// Mirrors the cache + batch shape used by src/lib/desk-embed.ts so a
// future "switch embedding model" change can touch both libs the same
// way. Differences:
//   - desk-embed wants vectors back for in-memory k-means; this lib
//     ships vectors to Postgres (formatted as pgvector literals).
//   - desk-embed uses ai-sdk's embedMany; here we go straight at the
//     OpenAI SDK because we already depend on it elsewhere and want a
//     single SDK surface for the index pipeline.

import OpenAI from 'openai';
import { env } from '@/env';
import { getCacheMany, hashString, setCacheMany } from './cache';
import type { InterviewChunk } from './interview-chunking';

const MODEL = 'text-embedding-3-small';
const DIM = 1536;
// OpenAI accepts up to 2048 inputs per call; staying at 100 keeps each
// request comfortably under the per-minute token cap and gives us small
// retry units when something fails mid-batch.
const BATCH = 100;
// Cache key prefix — bumping invalidates everything.
const CACHE_KEY_PREFIX = 'interview-embed:v1:text-embedding-3-small:';

export type EmbeddedInterviewChunk = InterviewChunk & {
  embedding: number[];
  // Pre-formatted pgvector literal: "[0.1,0.2,...]". Saves the route
  // handler from re-walking the vector when building INSERT rows.
  embedding_literal: string;
};

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _client;
}

function toVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}

function cacheKeyFor(content: string): string {
  // Hash the embed model + content so a model change invalidates cleanly
  // even before we bump CACHE_KEY_PREFIX.
  return `${CACHE_KEY_PREFIX}${hashString(content)}`;
}

/**
 * Embed every chunk, returning the originals augmented with the vector
 * and a pgvector-ready string. Uses cache_entries to dedupe across
 * re-indexes of the same content — content is fully content-addressed
 * (content hash + model), so the cache is safe to share across orgs.
 *
 * Throws on OpenAI failures after a single retry. The caller (route
 * handler) catches and marks the interview_job as `index_status = error`
 * — we don't want partial chunk rows landing on a transient blip.
 */
export async function embedInterviewChunks(
  chunks: InterviewChunk[],
): Promise<EmbeddedInterviewChunk[]> {
  if (chunks.length === 0) return [];
  if (!env.OPENAI_API_KEY) {
    throw new Error('missing_openai_api_key');
  }

  const keys = chunks.map((c) => cacheKeyFor(c.content));
  const cached = await getCacheMany<number[]>(keys);

  const vectors: number[][] = new Array(chunks.length);
  const missIdx: number[] = [];
  const missContent: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const hit = cached.get(keys[i]);
    if (hit && Array.isArray(hit) && hit.length === DIM) {
      vectors[i] = hit;
    } else {
      missIdx.push(i);
      missContent.push(chunks[i].content);
    }
  }

  // Call OpenAI in BATCH-sized slices for the misses.
  const fresh = new Map<number, number[]>();
  for (let i = 0; i < missContent.length; i += BATCH) {
    const sliceIdx = missIdx.slice(i, i + BATCH);
    const sliceContent = missContent.slice(i, i + BATCH);
    const res = await client().embeddings.create({
      model: MODEL,
      input: sliceContent,
    });
    if (res.data.length !== sliceContent.length) {
      throw new Error(
        `embedding_count_mismatch: expected=${sliceContent.length} got=${res.data.length}`,
      );
    }
    for (let j = 0; j < res.data.length; j++) {
      const v = res.data[j].embedding;
      if (!Array.isArray(v) || v.length !== DIM) {
        throw new Error(
          `embedding_dim_mismatch: expected=${DIM} got=${Array.isArray(v) ? v.length : 'n/a'}`,
        );
      }
      vectors[sliceIdx[j]] = v;
      fresh.set(sliceIdx[j], v);
    }
  }

  // Best-effort cache fill — failures swallowed by setCacheMany.
  if (fresh.size > 0) {
    void setCacheMany(
      [...fresh.entries()].map(([idx, v]) => ({ key: keys[idx], value: v })),
    );
  }

  return chunks.map((c, i) => ({
    ...c,
    embedding: vectors[i],
    embedding_literal: toVectorLiteral(vectors[i]),
  }));
}
