// Interview V2 hybrid retrieval orchestrator.
//
// Ties the three coverage layers (spec decisions 1–3) into one call:
//
//   A. hybrid  — vector (pgvector-query) ⊕ keyword (keyword-query), fused
//                with Reciprocal Rank Fusion so exact tokens the cosine path
//                misses (proper nouns / numbers / brands) are recovered.
//   C. floor   — per-document coverage floor on the fused ranking so the
//                top-K spreads across respondents instead of piling onto one.
//   B. big     — expand the surviving chunks to their parent Q&A pairs so the
//                LLM sees un-truncated evidence.
//
// Returns BOTH the chunk-level ranked set (`chunks`, pre-expansion — the fair
// unit for Recall@K measurement) and the parent-expanded evidence (`parents`,
// what the route feeds the model). The scope shape mirrors the route's three
// retrieval strategies so the per-project anti-pollution loop (prod incident
// 2026-07-03) is preserved for keyword too.

import type { createAdminClient } from '@/lib/supabase/admin';
import {
  searchInterviewV2Chunks,
  type InterviewV2Hit,
} from '@/lib/interview-v2/pgvector-query';
import { searchInterviewV2Keyword } from '@/lib/interview-v2/keyword-query';
import { rrfMerge, applyCoverageFloor } from '@/lib/interview-v2/retrieval';
import { expandHitsToParents } from '@/lib/interview-v2/parent-expand';

type AdminClient = ReturnType<typeof createAdminClient>;

// Retrieval scope, normalized by the route from its project_id / project_ids
// inputs (see route for the resolution rules):
//   single         — one project (uuid) or whole-org (null); direct RPC.
//   whole_org_multi — the _multi RPC with [] (legacy null-project docs).
//   per_project    — an explicit set; loop each + merge (anti flat-top-K).
export type HybridScope =
  // single — one project (uuid) or whole-org (null). documentId, when set,
  // narrows further to a single interview document (file-detail search); it is
  // only meaningful on this single-project path.
  | { kind: 'single'; projectId: string | null; documentId?: string | null }
  | { kind: 'whole_org_multi' }
  | { kind: 'per_project'; projectIds: string[] };

export type HybridSearchResult = {
  // Fused + coverage-floored ranking at CHUNK granularity (pre parent-expand).
  chunks: InterviewV2Hit[];
  // Parent-expanded evidence the route hands to the model.
  parents: InterviewV2Hit[];
  debug: {
    vector_count: number;
    keyword_count: number;
    fused_count: number;
    floored_count: number;
    parents_count: number;
  };
};

// Candidate pool per retriever before fusion — pull several × topK so RRF and
// the coverage floor have real material to work with (a floor that must touch
// many docs needs depth). Bounded so a huge topK doesn't explode the scan.
function candidatePool(topK: number): number {
  return Math.min(60, Math.max(30, topK * 3));
}

// Run vector + keyword for a scope, returning each retriever's ranked list.
async function retrievePair(
  admin: AdminClient,
  orgId: string,
  scope: HybridScope,
  query: string,
  poolK: number,
  scoreThreshold: number,
): Promise<{ vector: InterviewV2Hit[]; keyword: InterviewV2Hit[] }> {
  if (scope.kind === 'per_project') {
    const ids = scope.projectIds;
    // Give each project headroom so the merge has candidates from all of them,
    // never fewer than 3 (a small selection still pulls a useful spread).
    const perProjectK = Math.max(3, Math.ceil(poolK / Math.max(1, ids.length)));
    const [vecParts, kwParts] = await Promise.all([
      Promise.all(
        ids.map((pid) =>
          searchInterviewV2Chunks({
            client: admin,
            orgId,
            projectId: pid,
            query,
            k: perProjectK,
            scoreThreshold,
          }),
        ),
      ),
      Promise.all(
        ids.map((pid) =>
          searchInterviewV2Keyword({
            client: admin,
            orgId,
            projectId: pid,
            query,
            k: perProjectK,
          }),
        ),
      ),
    ]);
    return {
      vector: vecParts.flat().sort((a, b) => b.score - a.score),
      keyword: kwParts.flat().sort((a, b) => b.score - a.score),
    };
  }

  // single / whole_org_multi — one call each, run in parallel. On the single
  // path a documentId (file-detail search) narrows both halves to one file, so
  // keyword can't leak other-file chunks past the fusion.
  const single = scope.kind === 'single';
  const documentId = scope.kind === 'single' ? scope.documentId ?? null : null;
  const [vector, keyword] = await Promise.all([
    searchInterviewV2Chunks({
      client: admin,
      orgId,
      ...(single ? { projectId: scope.projectId, documentId } : { projectIds: [] }),
      query,
      k: poolK,
      scoreThreshold,
    }),
    searchInterviewV2Keyword({
      client: admin,
      orgId,
      ...(single ? { projectId: scope.projectId, documentId } : { projectIds: [] }),
      query,
      k: poolK,
    }),
  ]);
  return { vector, keyword };
}

export async function hybridSearch(opts: {
  admin: AdminClient;
  orgId: string;
  scope: HybridScope;
  query: string;
  topK: number;
  scoreThreshold: number;
  perDocFloor?: number;
  perDocCap?: number;
  // Skip parent expansion (Recall@K wants chunk granularity). Default false.
  expandParents?: boolean;
}): Promise<HybridSearchResult> {
  const {
    admin,
    orgId,
    scope,
    query,
    topK,
    scoreThreshold,
    perDocFloor = 1,
    perDocCap,
    expandParents = true,
  } = opts;

  const poolK = candidatePool(topK);
  const { vector, keyword } = await retrievePair(
    admin,
    orgId,
    scope,
    query,
    poolK,
    scoreThreshold,
  );

  // Vector first so, on RRF identity ties, the copy carrying the cosine score
  // wins (keyword score is a term-coverage ratio, not comparable).
  const fused = rrfMerge<InterviewV2Hit>([vector, keyword]);
  const chunks = applyCoverageFloor(fused, { topK, perDocFloor, perDocCap });

  const parents = expandParents
    ? await expandHitsToParents(admin, orgId, chunks)
    : chunks;

  return {
    chunks,
    parents,
    debug: {
      vector_count: vector.length,
      keyword_count: keyword.length,
      fused_count: fused.length,
      floored_count: chunks.length,
      parents_count: parents.length,
    },
  };
}
