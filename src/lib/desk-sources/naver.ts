// Shared Naver Search API fetcher. The four Naver sources (news/blog/cafe/kin)
// differ only by API `type` + metadata, so they share one paginating fetcher
// built here and each thin `naver-*.ts` module supplies its own definition.

import { env } from '@/env';
import type { DeskSourceFetcher, DeskSourceId } from './types';
import { inRange, safeFetch, stripHtml } from './helpers';

type NaverItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  bloggername?: string;
  postdate?: string;
  cafename?: string;
};
export type NaverType = 'news' | 'blog' | 'cafearticle' | 'kin';

export function naverFetcher(type: NaverType, source: DeskSourceId): DeskSourceFetcher {
  return async ({ keyword, range, limit }) => {
    const id = env.NAVER_CLIENT_ID;
    const secret = env.NAVER_CLIENT_SECRET;
    if (!id || !secret) return [];
    // Use `sort=date` whenever a range is set so we get the recent slice first
    // before post-filtering. KIN doesn't support date sort.
    const sort = (range.from || range.to) && type !== 'kin' ? 'date' : 'sim';
    // Naver: max display=100, start in 1..1000. Loop pages of 100 until limit.
    const display = 100;
    const out = [];
    for (let start = 1; start <= 1000 && out.length < limit; start += display) {
      const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(
        keyword,
      )}&display=${display}&start=${start}&sort=${sort}`;
      const res = await safeFetch(url, {
        headers: {
          'X-Naver-Client-Id': id,
          'X-Naver-Client-Secret': secret,
          accept: 'application/json',
        },
      });
      if (!res.ok) break;
      const json = (await res.json()) as { items?: NaverItem[]; total?: number };
      const items = json.items ?? [];
      if (items.length === 0) break;
      for (const it of items) {
        const title = it.title ? stripHtml(it.title) : '';
        const link = it.link ?? '';
        if (!title || !link) continue;
        const snippet = it.description ? stripHtml(it.description).slice(0, 280) : undefined;
        const publishedAt = it.pubDate
          ? it.pubDate
          : it.postdate && it.postdate.length === 8
            ? `${it.postdate.slice(0, 4)}-${it.postdate.slice(4, 6)}-${it.postdate.slice(6, 8)}`
            : undefined;
        if (!inRange(publishedAt, range)) continue;
        out.push({
          source,
          title,
          url: link,
          snippet,
          publishedAt,
          origin: it.bloggername || it.cafename,
          keyword,
        });
      }
      if (items.length < display) break;
    }
    return out.slice(0, limit);
  };
}
