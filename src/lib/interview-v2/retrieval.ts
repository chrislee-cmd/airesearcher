// Interview V2 hybrid retrieval — pure fusion + coverage helpers.
//
// These are the deterministic, DB-free core of hybrid search so they can be
// unit-tested without a Supabase round-trip:
//
//   * rrfMerge         — Reciprocal Rank Fusion of N ranked lists into one.
//   * applyCoverageFloor — per-document diversity guard (min N per doc, cap
//                          per doc) so the top-K never collapses onto one
//                          respondent.
//
// Both operate on any object carrying a numeric `chunk_id` + string
// `document_id`, so they work on InterviewV2Hit without importing it.

export type RankableHit = {
  chunk_id: number;
  document_id: string;
};

// RRF constant. 60 is the value from the original Cormack et al. paper and the
// de-facto default in pgvector/OpenSearch hybrid recipes — large enough that
// the top few ranks don't dominate, small enough that deep ranks still matter.
export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion.
 *
 * Each input list is an array already ordered best→worst. A hit's fused score
 * is Σ 1/(RRF_K + rank) across every list it appears in (rank is 0-based). A
 * hit present in multiple lists (found by BOTH vector and keyword) therefore
 * outranks one found by a single path — which is exactly the hybrid signal we
 * want. Deduped by chunk_id; the returned object for a given chunk_id is the
 * first occurrence encountered (lists are passed vector-first, so the vector
 * copy — which carries the cosine score — wins the identity).
 *
 * Ties (equal fused score) are broken by chunk_id ascending for determinism.
 */
export function rrfMerge<T extends RankableHit>(
  lists: T[][],
  opts?: { k?: number },
): T[] {
  const k = opts?.k ?? RRF_K;
  const scoreById = new Map<number, number>();
  const hitById = new Map<number, T>();

  for (const list of lists) {
    list.forEach((hit, rank) => {
      const id = hit.chunk_id;
      scoreById.set(id, (scoreById.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!hitById.has(id)) hitById.set(id, hit);
    });
  }

  return Array.from(hitById.values()).sort((a, b) => {
    const sa = scoreById.get(a.chunk_id) ?? 0;
    const sb = scoreById.get(b.chunk_id) ?? 0;
    if (sb !== sa) return sb - sa;
    return a.chunk_id - b.chunk_id;
  });
}

/**
 * Per-document coverage floor.
 *
 * Enforces respondent diversity on an already-ranked list: every document that
 * appears at all contributes at least `perDocFloor` chunks (subject to how many
 * it actually has), no document contributes more than `perDocCap`, and the
 * result is capped at `topK` total.
 *
 * Two passes over the ranked input (order preserved within each doc):
 *   1. Floor pass — walk docs in the order they first appear and take up to
 *      `perDocFloor` from each, guaranteeing spread before any single doc can
 *      hoard slots.
 *   2. Fill pass — top up by global rank, respecting `perDocCap`, until `topK`.
 *
 * The floor pass can itself exceed topK when there are many docs; in that case
 * diversity wins over raw rank (we keep the first topK floor picks, which are
 * still the best chunk from each of the top docs). This is the intended
 * behavior — a top-K that touches more respondents beats one that's deeper on
 * fewer.
 */
export function applyCoverageFloor<T extends RankableHit>(
  ranked: T[],
  opts: { topK: number; perDocFloor?: number; perDocCap?: number },
): T[] {
  const topK = Math.max(1, opts.topK);
  const perDocFloor = Math.max(0, opts.perDocFloor ?? 1);
  const perDocCap = Math.max(1, opts.perDocCap ?? topK);

  const taken = new Map<number, T>(); // chunk_id → hit (dedupe guard)
  const countByDoc = new Map<string, number>();

  const tryTake = (hit: T, docLimit: number): boolean => {
    if (taken.has(hit.chunk_id)) return false;
    const used = countByDoc.get(hit.document_id) ?? 0;
    if (used >= docLimit) return false;
    taken.set(hit.chunk_id, hit);
    countByDoc.set(hit.document_id, used + 1);
    return true;
  };

  // Pass 1 — floor: at most perDocFloor per doc, in first-appearance order.
  if (perDocFloor > 0) {
    for (const hit of ranked) {
      if (taken.size >= topK) break;
      tryTake(hit, perDocFloor);
    }
  }

  // Pass 2 — fill by global rank up to the per-doc cap, until topK.
  for (const hit of ranked) {
    if (taken.size >= topK) break;
    tryTake(hit, perDocCap);
  }

  // Re-project onto the original global ranking so the final order is by
  // relevance, not by which pass claimed a slot. Dedupe here too — a caller
  // that passes an un-fused list with repeated chunk_ids must not get them
  // back twice (rrfMerge already dedupes, but this stays correct standalone).
  const emitted = new Set<number>();
  return ranked
    .filter((h) => {
      if (!taken.has(h.chunk_id) || emitted.has(h.chunk_id)) return false;
      emitted.add(h.chunk_id);
      return true;
    })
    .slice(0, topK);
}
