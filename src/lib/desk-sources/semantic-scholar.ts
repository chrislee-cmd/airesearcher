import { env } from '@/env';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { inRange, safeFetch } from './helpers';

// Semantic Scholar (graph/v1) — 200M+ academic papers. Region-agnostic; the
// `region` param is ignored. The API key is OPTIONAL: with a key we get a
// higher rate limit, without one the public tier still works (just slower /
// rate-limited). So this source has no `envKeys` — it's always enabled and the
// key, when present, is attached as `x-api-key`.
//
// `citationCount` is fetched so a later tier-classifier can use it as a T1
// signal, but this PR only forwards it through — tier assignment lives in a
// separate spec.
type S2Author = { name?: string };
type S2Paper = {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  url?: string | null;
  year?: number | null;
  authors?: S2Author[];
  citationCount?: number | null;
  tldr?: { text?: string | null } | null;
};

export const semanticScholar: DeskSourceDefinition = {
  id: 'semantic_scholar',
  category: 'academic',
  // Spec asked for group `academic_intl`, which is not a valid DeskSourceGroup.
  // Semantic Scholar is keyless + region-agnostic, so it belongs in `global`;
  // its academic nature is carried by `category` above.
  group: 'global',
  label: 'Semantic Scholar',
  labelEn: 'Semantic Scholar',
  hint: '200M+ 학술 논문 (인용/영향력 포함)',
  // No envKeys — key is optional (raises the rate limit but not required).
  async fetch({ keyword, range, limit }) {
    const params = new URLSearchParams({
      query: keyword,
      // API hard-caps `limit` at 100 per call.
      limit: String(Math.min(100, Math.max(1, limit))),
      fields: 'title,abstract,url,year,authors,citationCount,tldr',
    });
    const headers: Record<string, string> = {};
    if (env.SEMANTIC_SCHOLAR_API_KEY) {
      headers['x-api-key'] = env.SEMANTIC_SCHOLAR_API_KEY;
    }
    const res = await safeFetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
      { headers },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: S2Paper[] };
    const out: DeskArticle[] = [];
    for (const p of json.data ?? []) {
      const title = p.title?.trim();
      if (!title) continue;
      const url = p.url || (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : '');
      if (!url) continue;
      // tldr (LLM auto-summary) preferred, then abstract.
      const snippetRaw = p.tldr?.text || p.abstract || '';
      const publishedAt = p.year ? `${p.year}-01-01` : undefined;
      const item: DeskArticle = {
        source: 'semantic_scholar',
        title,
        url,
        snippet: snippetRaw ? snippetRaw.trim().slice(0, 280) : undefined,
        publishedAt,
        origin: p.authors?.map((a) => a.name).filter(Boolean).join(', ') || undefined,
        keyword,
      };
      if (inRange(item.publishedAt, range)) out.push(item);
    }
    return out.slice(0, limit);
  },
};
