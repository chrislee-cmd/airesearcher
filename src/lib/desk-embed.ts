import { embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { DeskArticle } from './desk-sources';

// Pick a representative subset of articles by embedding them with OpenAI's
// text-embedding-3-small, clustering into k buckets via k-means++, and taking
// the article closest to each cluster centroid. The full pool stays available
// for storage/UI; only the LLM input gets compressed.
//
// Why this matters: at 1500 articles × ~250 tokens = ~375k input tokens, a
// single summarize call already burns 12× the per-minute org limit. Naive
// slice(0, 80) biases toward the first keyword. Stratified sampling helps but
// can't catch redundant wire-story reprints across sources. Embedding-based
// clustering does both.

function cosineDist(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// k-means++ initialisation — picks first centroid uniformly, then each next
// centroid with probability proportional to D(x)^2 from the closest existing
// centroid. Avoids the cluster-collapse you get with random init when k is
// large relative to natural cluster count.
function kmeansPlusPlus(points: number[][], k: number): number[][] {
  const n = points.length;
  const centroids: number[][] = [];
  centroids.push(points[Math.floor(Math.random() * n)].slice());
  while (centroids.length < k) {
    const dists = points.map((p) =>
      Math.min(...centroids.map((c) => cosineDist(p, c))),
    );
    const total = dists.reduce((s, d) => s + d * d, 0);
    if (total === 0) {
      centroids.push(points[Math.floor(Math.random() * n)].slice());
      continue;
    }
    let r = Math.random() * total;
    let chosen = -1;
    for (let i = 0; i < n; i++) {
      r -= dists[i] * dists[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    if (chosen < 0) chosen = n - 1;
    centroids.push(points[chosen].slice());
  }
  return centroids;
}

function runKMeans(
  points: number[][],
  k: number,
  maxIter = 15,
): { centroids: number[][]; assignments: number[] } {
  const centroids = kmeansPlusPlus(points, k);
  let assignments = new Array(points.length).fill(-1);
  const dim = points[0].length;

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    let changed = 0;
    const next = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = cosineDist(points[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      next[i] = best;
      if (next[i] !== assignments[i]) changed += 1;
    }
    assignments = next;
    if (iter > 0 && changed === 0) break;

    // Recompute centroids as mean of assigned points
    const sums: number[][] = Array.from({ length: k }, () =>
      new Array(dim).fill(0),
    );
    const counts = new Array(k).fill(0);
    for (let i = 0; i < points.length; i++) {
      const c = assignments[i];
      counts[c] += 1;
      for (let d = 0; d < dim; d++) sums[c][d] += points[i][d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // Empty cluster — reseed from the point currently farthest from
        // its centroid (data outlier most in need of its own bucket).
        let farthestIdx = 0;
        let farthestDist = -1;
        for (let i = 0; i < points.length; i++) {
          const d = cosineDist(points[i], centroids[assignments[i]]);
          if (d > farthestDist) {
            farthestDist = d;
            farthestIdx = i;
          }
        }
        centroids[c] = points[farthestIdx].slice();
      } else {
        for (let d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c];
      }
    }
  }

  return { centroids, assignments };
}

/**
 * Reduce a pool of articles to `k` semantically diverse representatives.
 *
 * - If the pool is already ≤ k, returns it unchanged.
 * - On embedding-API failure, falls back to a deterministic stratified sample
 *   (per-keyword equal slice) so the summarize step never blocks on this.
 */
export async function pickRepresentativeArticles(
  articles: DeskArticle[],
  k: number,
): Promise<DeskArticle[]> {
  if (articles.length <= k) return articles;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return stratifiedFallback(articles, k);
  }

  // Build the text to embed. Title is the strongest signal; we add origin and
  // a trimmed snippet so wire-story reprints across publishers cluster
  // together but distinct angles separate.
  const inputs = articles.map((a) => {
    const parts = [a.title];
    if (a.origin) parts.push(a.origin);
    if (a.snippet) parts.push(a.snippet.slice(0, 400));
    return parts.join('\n');
  });

  try {
    const openai = createOpenAI({ apiKey });
    const { embeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: inputs,
      maxRetries: 1,
    });
    if (embeddings.length !== articles.length) {
      return stratifiedFallback(articles, k);
    }
    const { centroids, assignments } = runKMeans(embeddings, k);

    // Pick the article closest to each centroid as the cluster's
    // representative. Some clusters may be empty after re-seeding; we just
    // skip those.
    const reps: DeskArticle[] = [];
    for (let c = 0; c < k; c++) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < articles.length; i++) {
        if (assignments[i] !== c) continue;
        const d = cosineDist(embeddings[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) reps.push(articles[bestIdx]);
    }
    // De-dup just in case (shouldn't happen unless an article lands as
    // representative for two clusters with identical centroids).
    const seen = new Set<string>();
    const unique = reps.filter((a) => {
      const key = a.url || `${a.source}|${a.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length >= Math.min(k, articles.length) * 0.8) {
      return unique;
    }
    // If clustering somehow collapsed too many points, fall back.
    return stratifiedFallback(articles, k);
  } catch (err) {
    console.error('[desk-embed] embedding failed, falling back', err);
    return stratifiedFallback(articles, k);
  }
}

// Deterministic backup if embeddings are unavailable: split k slots evenly
// across keywords, then within each keyword rotate through sources.
function stratifiedFallback(articles: DeskArticle[], k: number): DeskArticle[] {
  const byKeyword = new Map<string, DeskArticle[]>();
  for (const a of articles) {
    const key = a.keyword || '(미상)';
    const arr = byKeyword.get(key) ?? [];
    arr.push(a);
    byKeyword.set(key, arr);
  }
  const keywords = [...byKeyword.keys()];
  if (keywords.length === 0) return articles.slice(0, k);
  const perKw = Math.max(1, Math.floor(k / keywords.length));
  const out: DeskArticle[] = [];
  for (const kw of keywords) {
    const pool = byKeyword.get(kw) ?? [];
    // Rotate through sources within the keyword to spread coverage.
    const bySource = new Map<string, DeskArticle[]>();
    for (const a of pool) {
      const arr = bySource.get(a.source) ?? [];
      arr.push(a);
      bySource.set(a.source, arr);
    }
    const sources = [...bySource.keys()];
    let added = 0;
    let idx = 0;
    while (added < perKw && sources.some((s) => (bySource.get(s)?.length ?? 0) > 0)) {
      const src = sources[idx % sources.length];
      const list = bySource.get(src) ?? [];
      const item = list.shift();
      if (item) {
        out.push(item);
        added += 1;
      }
      idx += 1;
    }
  }
  return out.slice(0, k);
}
