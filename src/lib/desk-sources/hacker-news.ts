import type { DeskSourceDefinition } from './types';
import { safeFetch, stripHtml } from './helpers';

// Hacker News (Algolia). Region-agnostic — the `region` param is ignored.
type HNHit = {
  title?: string;
  story_title?: string;
  url?: string;
  objectID?: string;
  story_text?: string;
  created_at?: string;
};

export const hackerNews: DeskSourceDefinition = {
  id: 'hacker_news',
  category: 'community',
  group: 'global',
  label: '해커 뉴스',
  labelEn: 'Hacker News',
  hint: '테크/스타트업 영문',
  async fetch({ keyword, range, limit }) {
    const filters: string[] = [];
    if (range.from) {
      const ts = Math.floor(Date.parse(`${range.from}T00:00:00Z`) / 1000);
      if (!Number.isNaN(ts)) filters.push(`created_at_i>${ts}`);
    }
    if (range.to) {
      const ts = Math.floor(Date.parse(`${range.to}T23:59:59Z`) / 1000);
      if (!Number.isNaN(ts)) filters.push(`created_at_i<${ts}`);
    }
    // Algolia HN supports hitsPerPage up to 1000.
    const params = new URLSearchParams({
      query: keyword,
      hitsPerPage: String(Math.min(1000, Math.max(1, limit))),
    });
    if (filters.length) params.set('numericFilters', filters.join(','));
    const res = await safeFetch(`https://hn.algolia.com/api/v1/search?${params}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { hits?: HNHit[] };
    const hits = json.hits ?? [];
    return hits
      .map((h) => {
        const title = h.title || h.story_title || '';
        const url = h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '');
        const snippet = h.story_text ? stripHtml(h.story_text).slice(0, 280) : undefined;
        return {
          source: 'hacker_news' as const,
          title,
          url,
          snippet,
          publishedAt: h.created_at,
          origin: 'Hacker News',
          keyword,
        };
      })
      .filter((a) => a.title && a.url);
  },
};
