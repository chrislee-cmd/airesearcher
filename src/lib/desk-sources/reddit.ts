import type { DeskArticle, DeskSourceDefinition } from './types';
import { inRange, safeFetch, UA } from './helpers';

// Reddit (public JSON). Region-agnostic — the `region` param is ignored.
type RedditChild = {
  data?: {
    title?: string;
    url_overridden_by_dest?: string;
    permalink?: string;
    selftext?: string;
    created_utc?: number;
    subreddit_name_prefixed?: string;
  };
};

export const reddit: DeskSourceDefinition = {
  id: 'reddit',
  category: 'community',
  group: 'global',
  label: '레딧',
  labelEn: 'Reddit',
  hint: '글로벌 사용자 토론',
  async fetch({ keyword, range, limit }) {
    // Reddit's public search.json caps `limit` at 100 per call but supports
    // cursor pagination via `after`. Loop until limit or end of feed.
    const out: DeskArticle[] = [];
    let after: string | null = null;
    for (let page = 0; page < Math.ceil(limit / 100); page++) {
      const params = new URLSearchParams({
        q: keyword,
        limit: '100',
        sort: 'relevance',
      });
      if (after) params.set('after', after);
      const res = await safeFetch(
        `https://www.reddit.com/search.json?${params}`,
        { headers: { 'user-agent': UA } },
      );
      if (!res.ok) break;
      const json = (await res.json()) as {
        data?: { children?: RedditChild[]; after?: string | null };
      };
      const posts = json.data?.children ?? [];
      for (const p of posts) {
        const d = p.data ?? {};
        const url = d.url_overridden_by_dest || (d.permalink ? `https://www.reddit.com${d.permalink}` : '');
        const item: DeskArticle = {
          source: 'reddit',
          title: d.title ?? '',
          url,
          snippet: d.selftext ? d.selftext.trim().slice(0, 280) : undefined,
          publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
          origin: d.subreddit_name_prefixed || 'reddit',
          keyword,
        };
        if (item.title && item.url && inRange(item.publishedAt, range)) {
          out.push(item);
        }
      }
      after = json.data?.after ?? null;
      if (!after || posts.length === 0) break;
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  },
};
