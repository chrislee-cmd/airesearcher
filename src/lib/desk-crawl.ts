// Crawl orchestration. Source-specific fetch logic now lives in per-source
// modules under `desk-sources/` and is assembled by the registry — this file
// keeps only the dispatch + timeout + dedupe wrappers the API route calls.

import { DESK_SOURCE_REGISTRY } from './desk-sources';
import type {
  DeskArticle,
  DeskDateRange,
  DeskFetchResult,
  DeskRegion,
  DeskSourceId,
} from './desk-sources';
import { SOURCE_BUDGET, toFetchResult } from './desk-sources/helpers';
import { classifyTier } from './desk-source-tiers';

// Re-exported for back-compat with callers that imported these from
// `@/lib/desk-crawl` before the registry refactor (route.ts, etc).
export { SOURCE_BUDGET } from './desk-sources/helpers';
export { sourceMissingKey } from './desk-sources';
export type { DeskDateRange, DeskFetchResult } from './desk-sources';

// Registry lookup replaces the old per-source `switch`. Adding a source no
// longer touches this function — it just appears in `DESK_SOURCE_REGISTRY`.
// crawlSource never rejects: any fetch error is caught and returns a
// `{ articles: [], error }` result so one bad source can't poison a whole job,
// while the error reason still reaches the caller (no silent `[]`).
export async function crawlSource(
  source: DeskSourceId,
  keyword: string,
  region: DeskRegion = 'KR',
  range: DeskDateRange = {},
  // Caller decides how big this single (keyword × source) pull may be.
  // Defaults to the full source budget for back-compat with single-keyword
  // callers; the route divides SOURCE_BUDGET / N_keywords.
  limit: number = SOURCE_BUDGET,
): Promise<DeskFetchResult> {
  const def = DESK_SOURCE_REGISTRY[source];
  if (!def) return { articles: [] };
  try {
    return toFetchResult(await def.fetch({ keyword, region, range, limit }));
  } catch (err) {
    console.error('[desk-crawl]', source, keyword, err);
    return { articles: [], error: 'fetch_failed' };
  }
}

// Per-task hard wall-clock cap. A single (keyword × source × region) pull can
// balloon when a paginating source (Naver/Kakao loop pages of 50–100, each
// safeFetch up to 10s) keeps fetching to fill `limit` for a sparse keyword —
// up to ~10 sequential fetches ≈ 100s for ONE task. That single slow task was
// the dominant cause of the 211s crawl in the 2026-06-30 timeout incident.
// 15s lets a normal multi-page pull finish while capping the pathological case.
export const CRAWL_TASK_TIMEOUT_MS = 15_000;

// Race a single crawlSource against a hard timeout. crawlSource never rejects
// (it catches internally and returns a result), so a timeout simply resolves to
// `{ articles: [], error: 'fetch_failed' }` — a graceful "this task failed to
// respond in time". Because the route fires all tasks via Promise.all (fully
// concurrent), this bounds the whole crawl phase's wall-clock to ≈
// CRAWL_TASK_TIMEOUT_MS regardless of task count. The orphaned underlying fetch
// is still aborted by safeFetch's own 10s timer, so nothing leaks past the
// function's lifetime. The job-level aggregation only surfaces this error when
// the source collected 0 articles across all its tasks, so a slow task on one
// keyword doesn't false-alarm when another keyword succeeded.
export async function crawlSourceWithTimeout(
  source: DeskSourceId,
  keyword: string,
  region: DeskRegion = 'KR',
  range: DeskDateRange = {},
  limit: number = SOURCE_BUDGET,
  timeoutMs: number = CRAWL_TASK_TIMEOUT_MS,
): Promise<DeskFetchResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DeskFetchResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ articles: [], error: 'fetch_failed' }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      crawlSource(source, keyword, region, range, limit),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function dedupeArticles(articles: DeskArticle[]): DeskArticle[] {
  const seen = new Set<string>();
  const out: DeskArticle[] = [];
  for (const a of articles) {
    const key = a.url || `${a.source}|${a.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Tag with source tier in the same pass — every article that survives
    // dedupe should carry a tier so the runner / downstream synthesis can
    // weight evidence without re-running the classifier later.
    out.push({ ...a, tier: classifyTier(a.url) });
  }
  return out;
}
